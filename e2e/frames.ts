// In-page instrumentation shared by every spec (plan §10.8 "settle signal" and "motion"):
//   - seeded Math.random and crypto, so ids (and the layouts that hash them) repeat on every run;
//   - a DOM mutation counter that ignores the agent's SVG, whose fluid loop writes every frame;
//   - frame control: while it is on, every Web Animation (WAAPI from Motion, CSS transitions and
//     keyframes) is paused and seeked to its age on the fake clock, so a frame taken after
//     page.clock.runFor(t) shows JS timers, rAF and compositor animations at the same instant t.
// With E2E_TRACE_DIR set, captureFrames also writes a DOM and animation dump next to every frame,
// to find where two runs (or two builds) diverge.
import { expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { THRESHOLD } from "./env";

/** Frame times after a trigger, in ms (§10.8). */
export const FRAME_TIMES = [0, 120, 240, 480, 900, 1750] as const;

/** Allowed differing pixels per motion frame (filter and blur rasterisation): 0.1%. */
export const FRAME_TOLERANCE = 0.001;

export interface Sample {
  /** DOM mutations outside the agent SVG since the page started */
  mutations: number;
  /** The last of them, for diagnostics */
  last: string;
  /** Finite Web Animations not finished yet (running, or paused by frame control) */
  pending: string[];
  /** The agent SVG's markup, to tell when the fluid has come to rest */
  agent: string;
  /** The store phase, when the build exposes a store handle */
  phase: string | null;
}

declare global {
  interface Window {
    __e2e?: {
      mutations: number;
      last: string;
      sample: () => Sample;
      frames: { on: boolean; start: () => void; seek: () => void; stop: () => void };
      /** Resolves after `n` frames rendered by the browser (the native rAF, never the fake clock's) */
      rendered: (n: number) => Promise<void>;
      /** Resolves once the real tasks already posted on MessageChannel have run */
      drain: () => Promise<void>;
    };
  }
}

/** Runs before any page script, in every document of the page. */
function instrument() {
  if (window.__e2e) return;
  // Captured before the fake clock (and, in stepped mode, settle.ts's frameGrid) replace them,
  // when this script runs first: it does in Chromium (see realFrames)
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const NativeChannel = window.MessageChannel;

  // Seeded randomness: v0 mints ids with Math.random and the collage hashes them, v2 mints with
  // crypto. The same seed on every run and every build keeps ids, and so layouts, reproducible.
  let seed = 0x5eed1014;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;
  crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
    }
    return array;
  };
  crypto.randomUUID = () => {
    const h = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` as `${string}-${string}-${string}-${string}-${string}`;
  };

  const isAgent = (node: Node | null): boolean => {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
    const svg = el?.closest("svg");
    return !!svg && !!svg.querySelector("filter#form-goo");
  };
  const describe = (node: Node) => {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!el) return node.nodeName;
    const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };

  // The page's clock is fake but document.timeline is real: an animation's age is kept here, in
  // fake milliseconds, and applied through the native setters
  const birth = new WeakMap<Animation, number>();
  const proto = Animation.prototype;
  const nativeStart = Object.getOwnPropertyDescriptor(proto, "startTime")!;
  const nativeCurrent = Object.getOwnPropertyDescriptor(proto, "currentTime")!;
  const nativePlay = proto.play;
  const setCurrent = (a: Animation, ms: number) => nativeCurrent.set!.call(a, ms);
  const state = {
    mutations: 0,
    last: "",
    sample: (): Sample => {
      const pending = document
        .getAnimations()
        .filter((a) => (a.playState === "running" || a.playState === "paused") && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target;
          return `${a.constructor.name}${target ? " on " + describe(target) : ""}`;
        });
      const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("filter#form-goo"));
      const handle = (window as unknown as { __form?: { getState?: () => { phase?: string } } }).__form;
      return { mutations: state.mutations, last: state.last, pending, agent: svg?.innerHTML ?? "", phase: handle?.getState?.().phase ?? null };
    },
    drain: () =>
      new Promise<void>((resolve) => {
        // Posted messages run in order: three round trips let a render and the work it posts finish
        let left = 3;
        const channel = new NativeChannel();
        channel.port1.onmessage = () => {
          left -= 1;
          if (left <= 0) resolve();
          else channel.port2.postMessage(0);
        };
        channel.port2.postMessage(0);
      }),
    rendered: (n: number) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => {
          left -= 1;
          if (left <= 0) resolve();
          else nativeRaf(tick);
        };
        nativeRaf(tick);
      }),
    frames: {
      on: false,
      /** Starts stepping: existing animations restart from age 0 now; new ones are paused at birth. */
      start() {
        const now = performance.now();
        for (const a of document.getAnimations()) {
          if (a.playState === "finished") continue;
          birth.set(a, now);
        }
        state.frames.on = true;
        state.frames.seek();
        const loop = () => {
          if (!state.frames.on) return;
          state.frames.seek();
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      },
      /** Pauses every animation at its age on the fake clock; finishes the ones past their end. */
      seek() {
        const now = performance.now();
        for (const a of document.getAnimations()) {
          if (a.playState === "finished" || a.playState === "idle") continue;
          if (!birth.has(a)) birth.set(a, now);
          const age = (now - birth.get(a)!) * (a.playbackRate || 1);
          const end = Number(a.effect?.getComputedTiming().endTime ?? 0);
          if (Number.isFinite(end) && age >= end) a.finish();
          else {
            a.pause();
            setCurrent(a, Math.max(0, age));
          }
        }
      },
      stop() {
        state.frames.on = false;
        for (const a of document.getAnimations()) if (a.playState === "paused") nativePlay.call(a);
      },
    },
  };
  window.__e2e = state;

  // While stepping, no animation runs on real time: script-created ones are paused at birth, and
  // the timing a library writes (Motion sets startTime from its frame clock, which is the fake one)
  // is read as fake time instead of being applied to the real timeline
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
    const a = animate.apply(this, args);
    if (state.frames.on) {
      birth.set(a, performance.now());
      a.pause();
      setCurrent(a, 0);
    }
    return a;
  };
  Object.defineProperty(proto, "startTime", {
    configurable: true,
    get(this: Animation) {
      return nativeStart.get!.call(this);
    },
    set(this: Animation, value: CSSNumberish | null) {
      if (!state.frames.on || value === null) return nativeStart.set!.call(this, value);
      birth.set(this, Number(value));
      this.pause();
      setCurrent(this, Math.max(0, (performance.now() - Number(value)) * (this.playbackRate || 1)));
    },
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get(this: Animation) {
      return nativeCurrent.get!.call(this);
    },
    set(this: Animation, value: CSSNumberish | null) {
      if (state.frames.on && value !== null) birth.set(this, performance.now() - Number(value) / (this.playbackRate || 1));
      nativeCurrent.set!.call(this, value);
    },
  });
  proto.play = function (this: Animation) {
    if (!state.frames.on) return nativePlay.call(this);
    // A finished animation restarts from 0; a paused one stays paused and follows the fake clock
    if (this.playState === "finished" || this.playState === "idle") {
      nativePlay.call(this);
      birth.set(this, performance.now());
    } else if (!birth.has(this)) birth.set(this, performance.now());
    this.pause();
  };

  // Input changes styles at once (hover, focus, React's synchronous render of a click), and the
  // CSS transitions they start would run on real time until the next frame's seek: on a busy
  // machine a short one could even finish first. Right after the app has handled each input
  // event, a seek catches them at age 0.
  for (const type of ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "click", "keydown", "keyup", "input", "focusin", "focusout"]) {
    window.addEventListener(type, () => state.frames.on && queueMicrotask(() => state.frames.seek()));
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (isAgent(r.target)) continue;
      state.mutations++;
      state.last = `${r.type} ${r.attributeName ?? ""} on ${describe(r.target)}`;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

/** Installs the instrumentation; call before the first navigation. */
export async function instrumentPage(page: Page) {
  await page.addInitScript(instrument);
}

export async function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => window.__e2e!.sample());
}

/** Starts frame control on a page whose clock is paused (`open` in stepped mode does it). */
export async function startFrameControl(page: Page) {
  await page.evaluate(() => window.__e2e!.frames.start());
  // Chromium can also stop the real document timeline (DevTools' animation speed set to 0), so a CSS
  // transition the browser starts between two seeks waits at age 0 instead of running on real
  // time; how far it would get otherwise depends on how long the last screenshot or comparison took
  if (page.context().browser()?.browserType().name() === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  }
}

/**
 * Advances the paused clock one frame (16 ms) at a time. After each fake frame the browser renders
 * four real ones: ResizeObserver callbacks (useWidth, the Focus stage) only run while the browser
 * renders, so without that wait a layout change would reach React one fake frame later on a busy
 * run than on an idle one. Their setState then lands on the fake clock, at the same instant on
 * every run. Real tasks the frame posted (a scheduler that bypasses frameGrid) run too.
 */
export async function stepClock(page: Page, ms: number) {
  for (let left = ms; left > 0; left -= 16) {
    await page.clock.runFor(Math.min(16, left));
    await afterFrame(page);
  }
}

/** Four real rendered frames (two proved too few under load), then the real tasks already posted. */
export async function afterFrame(page: Page) {
  await realFrames(page, 4);
  await page.evaluate(() => window.__e2e!.drain());
}

/**
 * Waits for `n` frames the browser really renders. Chromium runs this file's init script before
 * the clock's, so the captured requestAnimationFrame is the native one; WebKit installs the clock
 * first, and there the wait is real time instead (stills only: no frame stepping runs in WebKit).
 */
export async function realFrames(page: Page, n: number) {
  if (page.context().browser()?.browserType().name() === "chromium") await page.evaluate((n) => window.__e2e!.rendered(n), n);
  else await page.waitForTimeout(n * 17);
}

/**
 * Captures the frames of one trigger (§10.8 motion) on a page opened in stepped mode: the trigger
 * runs at frame 0, then the fake clock is stepped to each frame time and every animation follows it.
 */
export async function captureFrames(page: Page, name: string, trigger: () => Promise<void>, { keepPointer = false } = {}) {
  await trigger();
  // A pointer left over the content would change hover states whenever the browser renders a real
  // frame (each screenshot does) as the layout moves under it. Parked in the empty top-left corner
  // at frame 0, it changes nothing after; hover triggers keep it where they put it.
  if (!keepPointer) await page.mouse.move(0, 0);
  let elapsed = 0;
  for (const t of FRAME_TIMES) {
    await stepClock(page, t - elapsed);
    elapsed = t;
    await page.evaluate(() => window.__e2e!.frames.seek());
    // A fixed number of real frames lets the compositor finish rasterising the paused scene
    await realFrames(page, 12);
    // Exactly one screenshot per frame, in reference and candidate runs alike. toHaveScreenshot
    // retakes until two agree, and every take renders real frames the page can react to
    const shot = await page.screenshot({ animations: "allow", caret: "hide", scale: "device" });
    if (process.env.E2E_TRACE_DIR) {
      const dump = await page.evaluate(() => {
        const styled = [...document.querySelectorAll<HTMLElement>("[style]")].map((e) => `${e.tagName}.${String(e.className).slice(0, 40)} ${e.getAttribute("style")}`);
        const anims = document.getAnimations().map((a) => `${a.constructor.name}:${a.playState}:${Math.round(Number(a.currentTime))}:${(a.effect as KeyframeEffect)?.target?.tagName}.${String(((a.effect as KeyframeEffect)?.target as HTMLElement)?.className).slice(0, 30)}`);
        const texts = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0).map((e) => e.textContent).join("|");
        return `${performance.now()}\n${styled.join("\n")}\nANIMS\n${anims.join("\n")}\nTEXT ${texts}`;
      });
      writeFileSync(`${process.env.E2E_TRACE_DIR}/${name}-${t}.txt`, dump);
    }
    expect(shot, `${name} at ${t} ms`).toMatchSnapshot(`${name}-${String(t).padStart(4, "0")}ms.png`, {
      maxDiffPixelRatio: FRAME_TOLERANCE,
      threshold: THRESHOLD,
    });
  }
}
