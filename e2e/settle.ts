// Opening /demo with a seeded workspace, and knowing when it has come to rest (plan §10.8).
//
// Clock modes:
//   - "stepped": the fake clock is paused before the page loads and only moves through runFor, and
//     frame control keeps every Web Animation on that clock. Timers, rAF, Motion, GSAP and CSS all
//     advance together, so the same steps give the same pixels on every run. Stills and frames.
//   - "natural": the fake clock starts at the frozen time and then runs with real time. Videos.
import { expect, type Page } from "@playwright/test";
import { APP_PATH } from "./env";
import { afterFrame, instrumentPage, sample, startFrameControl, type Sample } from "./frames";
import { fixtureText, moodImageBase64, type FixtureName } from "./states";

/** The frozen clock: 2026-10-14, 10:00 in Rome (§10.8). */
export const FROZEN_TIME = "2026-10-14T10:00:00+02:00";

/** The settle signal's idle span (§10.8). */
export const QUIET_MS = 1500;

/** On the stepped clock, a settle always lasts a whole number of these. */
export const SETTLE_BLOCK_MS = 2000;

export interface Seed {
  /** Show the first-visit intro (no `form.intro.seen.v1`) */
  intro?: boolean;
  /** The v0 workspace stored under `form.workspace.v1`, or none */
  doc?: FixtureName | null;
  /** Store the fixture image under its asset id in IndexedDB (`form-assets` / `images`) */
  image?: boolean;
}

export type ClockMode = "stepped" | "natural";

/** Seeds storage once per tab: a reload keeps what the app saved, as a user's would. */
function seedStorage(arg: { intro: boolean; doc: string | null; image: string | null }) {
  if (sessionStorage.getItem("e2e.seeded")) return;
  sessionStorage.setItem("e2e.seeded", "1");
  localStorage.clear();
  if (!arg.intro) localStorage.setItem("form.intro.seen.v1", "1");
  if (arg.doc) localStorage.setItem("form.workspace.v1", arg.doc);
  if (arg.image) {
    const bytes = Uint8Array.from(atob(arg.image), (c) => c.charCodeAt(0));
    const req = indexedDB.open("form-assets", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("images");
    // The app's own read transaction is created later on the same database, so it sees this write
    req.onsuccess = () => req.result.transaction("images", "readwrite").objectStore("images").put(new Blob([bytes], { type: "image/png" }), "img-fixture1");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stepped mode only, installed after the clock's own script. The fake clock's Date is exact, but its
 * performance.now() counts from when the document started and its rAF fires on a 16 ms grid of
 * that same count: both shift by the few real milliseconds a load takes, so the first frame after
 * a trigger came 1 to 16 ms later on one run than on another. Here performance.now() counts from
 * the install, and frames fall every 16 ms from the frozen time, on the fake setTimeout: the same
 * instants on every run.
 */
function frameGrid({ origin, frozen }: { origin: number; frozen: number }) {
  const now = () => Date.now() - origin;
  Object.defineProperty(performance, "now", { configurable: true, value: now });
  const timeout = window.setTimeout.bind(window);
  let queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  let pending = false;
  const frame = () => {
    pending = false;
    const run = queue;
    queue = new Map();
    const t = now();
    for (const cb of run.values()) cb(t);
  };
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = next++;
    queue.set(id, cb);
    if (!pending) {
      pending = true;
      const sinceGrid = (Date.now() - frozen) % 16;
      timeout(frame, 16 - (sinceGrid < 0 ? sinceGrid + 16 : sinceGrid));
    }
    return id;
  };
  window.cancelAnimationFrame = (id: number) => void queue.delete(id);

  // React's scheduler runs its work on MessageChannel, a real task that lands before or after the
  // next fake frame depending on load. Delivered on the fake setTimeout instead, every render
  // happens at a fixed point of the fake timeline
  class Port extends EventTarget {
    other: Port | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage(data: unknown) {
      const to = this.other;
      timeout(() => {
        if (!to) return;
        const event = new MessageEvent("message", { data });
        to.onmessage?.(event);
        to.dispatchEvent(event);
      }, 0);
    }
    start() {}
    close() {
      this.other = null;
    }
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      this.port1.other = this.port2;
      this.port2.other = this.port1;
    }
  }
  (window as unknown as { MessageChannel: unknown }).MessageChannel = Channel;
}

/** Instruments the page and seeds its storage; call before the first navigation. */
export async function prepare(page: Page, seed: Seed) {
  await instrumentPage(page);
  await page.addInitScript(seedStorage, {
    intro: !!seed.intro,
    doc: seed.doc ? fixtureText(seed.doc) : null,
    image: seed.image ? moodImageBase64() : null,
  });
}

/** Opens the app seeded with `seed`, on the frozen clock, and waits until it has settled. */
export async function open(page: Page, seed: Seed, mode: ClockMode = "stepped"): Promise<App> {
  await prepare(page, seed);
  if (mode === "stepped") {
    // Installed a minute early and paused exactly at the frozen time: an install at the frozen time
    // would already have run a few real milliseconds, a different number on every run
    const installed = Date.parse(FROZEN_TIME) - 60_000;
    await page.clock.install({ time: installed });
    await page.clock.pauseAt(FROZEN_TIME);
    await page.addInitScript(frameGrid, { origin: installed, frozen: Date.parse(FROZEN_TIME) });
  } else await page.clock.install({ time: FROZEN_TIME });
  await page.goto(APP_PATH, { waitUntil: "load" });
  // ClientRoot renders the app after mount; its sr-only h1 is the first thing it draws. On the
  // stepped clock React's work waits on fake timers, so the clock moves a frame at a time until then
  const h1 = page.locator("main h1");
  if (mode === "stepped") {
    for (let i = 0; !(await h1.count()); i++) {
      if (i > 600) throw new Error("The app never mounted");
      await page.clock.runFor(16);
      await sleep(20);
    }
  } else await h1.waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const app = new App(page, mode);
  if (mode === "stepped") await startFrameControl(page);
  await app.settle();
  await app.firstLoadNotice();
  return app;
}

export class App {
  /** The one-off first-load caption, when the build shows one (v2: "Schedule now skips weekends.") */
  notice: string | null = null;

  constructor(
    readonly page: Page,
    readonly mode: ClockMode,
  ) {}

  /**
   * Waits for the settle signal: no unfinished finite animation, no DOM change outside the agent
   * for QUIET_MS, the store at rest when a handle exists and, with `agent`, the fluid unchanged too.
   *
   * On the stepped clock time passes in whole blocks of SETTLE_BLOCK_MS, so the clock reads the
   * same after every settle on every run: a later trigger meets the same phase of every endless
   * motion, such as the agent's breathing.
   */
  async settle({ agent = false, timeout = 30_000 }: { agent?: boolean; timeout?: number } = {}): Promise<void> {
    const step = 100;
    let prev: Sample = await sample(this.page);
    let quiet = 0;
    for (let spent = step; spent <= timeout; spent += step) {
      if (this.mode === "stepped") {
        await this.page.clock.runFor(step);
        // Real-time work (observers, IndexedDB, image decoding) catches up between steps
        await afterFrame(this.page);
      } else await sleep(step);
      const s = await sample(this.page);
      const calm = s.mutations === prev.mutations && s.pending.length === 0 && (s.phase === null || s.phase === "rest") && (!agent || s.agent === prev.agent);
      quiet = calm ? quiet + step : 0;
      prev = s;
      if (quiet >= QUIET_MS && (this.mode === "natural" || spent % SETTLE_BLOCK_MS === 0)) return;
    }
    throw new Error(`Never settled in ${timeout} ms: last change "${prev.last}", pending ${JSON.stringify(prev.pending)}, phase ${prev.phase}`);
  }

  /** Runs the clock for `ms` (stepped) or waits for it (natural). */
  async wait(ms: number) {
    if (this.mode === "stepped") await this.page.clock.runFor(ms);
    else await sleep(ms);
  }

  /** The caption on screen, if any. */
  caption() {
    return this.page.getByRole("status");
  }

  /** Records and dismisses the one-off caption a migrated save shows on first load (C only). */
  async firstLoadNotice() {
    const caption = this.caption();
    if (!(await caption.count())) return;
    // The caption's text is a RevealText, which carries the whole sentence as its label
    const label = await caption.first().locator("[aria-label]").first().getAttribute("aria-label");
    this.notice = label ?? (await caption.first().innerText());
    await this.dismissCaption();
  }

  async dismissCaption() {
    const caption = this.caption();
    if (!(await caption.count())) return;
    await caption.getByRole("button", { name: "Dismiss" }).click();
    await this.settle();
  }

  /** Types a command into the composer and sends it, as a user would ("/" opens it). */
  async command(text: string, { keepCaption = false, expectClose = true }: { keepCaption?: boolean; expectClose?: boolean } = {}) {
    const input = this.page.getByRole("textbox", { name: "Command" });
    if (!(await input.count())) await this.page.keyboard.press("/");
    await input.waitFor();
    await this.wait(200);
    await input.fill(text);
    await input.press("Enter");
    // On the stepped clock nothing leaves the screen until the clock runs: settle first
    await this.settle();
    if (expectClose) await expect(input, `"${text}" should be accepted`).toHaveCount(0, { timeout: 1_000 });
    if (!keepCaption) await this.dismissCaption();
  }

  /** Opens a created view through its tab. */
  async tab(view: string) {
    await this.page.locator(`[data-rep-tab="${view}"]`).click();
    await this.settle();
  }

  /** Point & Ask: selects a task through its number badge. */
  async select(title: string) {
    await this.page.getByRole("button", { name: `Select ${title} to ask FORM about it` }).first().click();
    await this.settle();
  }

  async click(name: string | RegExp) {
    await this.page.getByRole("button", { name, exact: typeof name === "string" }).first().click();
    await this.settle();
  }

  /** Back at the top, mouse away from every control, everything at rest: ready for a still. */
  async readyForStill() {
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.mouse.move(0, 0);
    await this.settle({ agent: true });
  }
}
