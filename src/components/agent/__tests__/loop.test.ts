import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BREATH, WAKE_RADIUS, breathAmplitude, nearAnchor, nextBreath, pointerReach, useSettlingLoop, type LoopStep, type SettlingLoop } from "../loop";

// Motion's frame loop, driven by hand: every scheduled job runs once per runFrame()
const clock = vi.hoisted(() => ({ jobs: new Set<(data: { timestamp: number; delta: number; isProcessing: boolean }) => void>(), now: 5000 }));
vi.mock("motion/react", () => ({
  frame: {
    update: (job: (data: { timestamp: number; delta: number; isProcessing: boolean }) => void) => {
      clock.jobs.add(job);
      return job;
    },
  },
  cancelFrame: (job: (data: { timestamp: number; delta: number; isProcessing: boolean }) => void) => void clock.jobs.delete(job),
}));

function runFrame(delta = 16) {
  clock.now += delta;
  for (const job of [...clock.jobs]) job({ timestamp: clock.now, delta, isProcessing: true });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("breath (Q29)", () => {
  it("holds full breath while the target is 1", () => {
    expect(nextBreath(1, 1, 1 / 60)).toBe(1);
    expect(breathAmplitude(1)).toBe(1);
  });

  it("fades from full to nothing over BREATH.fade seconds, then holds 0", () => {
    let level = 1;
    let frames = 0;
    while (level > 0) {
      level = nextBreath(level, 0, 1 / 60);
      frames++;
    }
    expect(frames).toBe(Math.round(BREATH.fade * 60));
    expect(nextBreath(0, 0, 1 / 60)).toBe(0);
    expect(breathAmplitude(0)).toBe(0);
  });

  it("comes back at the same rate after an input", () => {
    expect(nextBreath(0, 1, BREATH.fade / 2)).toBeCloseTo(0.5);
    expect(nextBreath(0.9, 1, BREATH.fade)).toBe(1);
  });

  it("eases the amplitude in and out", () => {
    expect(breathAmplitude(0.5)).toBe(0.5);
    for (let x = 0; x < 1; x += 0.05) expect(breathAmplitude(x + 0.05)).toBeGreaterThan(breathAmplitude(x));
  });
});

describe("pointer reach", () => {
  it("wakes within 1.5 × the influence radius of the anchor (330 × scale)", () => {
    const anchor = { x: 100, y: 100 };
    expect(WAKE_RADIUS).toBe(330);
    expect(nearAnchor(100 + 330 * 1.22, 100, anchor, 1.22)).toBe(true);
    expect(nearAnchor(100 + 330 * 1.22 + 1, 100, anchor, 1.22)).toBe(false);
  });

  it("keeps all of the pull well inside the wake radius and none beyond it", () => {
    expect(pointerReach(0, 1)).toBe(1);
    expect(pointerReach(0.7 * 330, 1)).toBe(1);
    expect(pointerReach(330, 1)).toBe(0);
    expect(pointerReach(900, 1)).toBe(0);
    let prev = 1;
    for (let d = 0.7 * 330; d <= 330; d += 5) {
      const r = pointerReach(d, 1);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
    expect(pointerReach(0.85 * 330 * 2, 2)).toBeGreaterThan(0);
  });
});

describe("useSettlingLoop", () => {
  let root: Root;
  let container: HTMLElement;
  let loop: SettlingLoop;
  const calls: number[] = [];
  let settleAt = Infinity;
  const step: LoopStep = (ms) => {
    calls.push(ms);
    return ms >= settleAt;
  };

  function Harness({ awake, enabled }: { awake: unknown; enabled: boolean }) {
    loop = useSettlingLoop(step, { awake, enabled });
    return null;
  }
  const render = (awake: unknown, enabled = true) => act(() => root.render(createElement(Harness, { awake, enabled })));

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    clock.jobs.clear();
    calls.length = 0;
    settleAt = Infinity;
    setHidden(false);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it("runs every frame with the time since its first frame, like useAnimationFrame", () => {
    render("a");
    expect(loop.time()).toBe(0);
    runFrame();
    runFrame();
    runFrame();
    expect(calls).toEqual([0, 16, 32]);
    expect(loop.running()).toBe(true);
    expect(loop.time()).toBe(32);
  });

  it("sleeps once the step reports the material settled, and schedules nothing more", () => {
    settleAt = 32;
    render("a");
    for (let i = 0; i < 6; i++) runFrame();
    expect(calls).toEqual([0, 16, 32]);
    expect(loop.running()).toBe(false);
    expect(clock.jobs.size).toBe(0);
    // Asleep, its clock reads the current time on the same origin
    runFrame(100);
    expect(loop.time()).toBe(32 + 16 * 3 + 100);
  });

  it("wakes on a change of `awake`, and only on a change", () => {
    settleAt = 0;
    render("a");
    runFrame();
    expect(loop.running()).toBe(false);
    render("a");
    runFrame();
    expect(calls).toHaveLength(1);
    settleAt = Infinity;
    render("b");
    runFrame();
    expect(calls).toHaveLength(2);
    expect(loop.running()).toBe(true);
  });

  it("wakes on wake()", () => {
    settleAt = 0;
    render("a");
    runFrame();
    loop.wake();
    runFrame();
    expect(calls).toHaveLength(2);
  });

  it("never runs while disabled (reduced motion)", () => {
    render("a", false);
    loop.wake();
    render("b", false);
    runFrame();
    expect(calls).toHaveLength(0);
    render("b", true);
    runFrame();
    expect(calls).toHaveLength(1);
  });

  it("stops on a hidden tab and resumes when it is visible again", () => {
    render("a");
    runFrame();
    act(() => setHidden(true));
    runFrame();
    expect(calls).toHaveLength(1);
    expect(clock.jobs.size).toBe(0);
    act(() => setHidden(false));
    runFrame();
    expect(calls).toHaveLength(2);
  });

  it("defers a wake while hidden, and doesn't run a settled loop just because the tab is shown", () => {
    settleAt = 0;
    render("a");
    runFrame();
    act(() => setHidden(true));
    act(() => setHidden(false));
    runFrame();
    expect(calls).toHaveLength(1);
    act(() => setHidden(true));
    loop.wake();
    runFrame();
    expect(calls).toHaveLength(1);
    act(() => setHidden(false));
    runFrame();
    expect(calls).toHaveLength(2);
  });

  it("stops when unmounted", () => {
    render("a");
    runFrame();
    act(() => root.unmount());
    runFrame();
    expect(calls).toHaveLength(1);
    root = createRoot(container);
  });
});
