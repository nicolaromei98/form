"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { BLOB_COUNT, DROPS, RING, RING_R, type AgentMode, type Circle, type Vec } from "./geometry";
import { BREATH, INFLUENCE, REST, breathAmplitude, nearAnchor, nextBreath, pointerReach, useSettlingLoop } from "./loop";

/**
 * FORM's fluid body.
 *
 * Every volume is a damped spring particle with mass. Homes come from the
 * agent geometry; the motion between them is simulated, not tweened — so the
 * material carries inertia, overshoots a little, stretches along its velocity
 * and pinches off. The goo filter on the parent group fuses the result.
 *
 * At rest the material comes to a stop (plan §9.1): the breathing fades out
 * 4 s after the last input, and once every volume has been still for 500 ms
 * the volumes snap home, are written once more and the loop sleeps. A prop
 * change, a pointer near the agent or the tab coming back wakes it. Under
 * reduced motion there is no loop: the homes are written once per change.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  m: number;
  /** Clock time before which the particle holds its snapshot home */
  release: number;
  hx: number;
  hy: number;
  hr: number;
  /** One-off tangential push applied on release (birth swirl) */
  kick: number;
}

interface Props {
  mode: AgentMode;
  anchor: Vec;
  scale: number;
  /** Homes for non-ring modes: BLOB_COUNT volumes */
  targets: Circle[];
  satellite: Circle;
  pressed: boolean;
  reduced: boolean;
  /** The idle ring or the docked pill, with no creation running: the only states the material may settle in */
  rest: boolean;
}

const SAT = BLOB_COUNT; // satellite index
const COUNT = BLOB_COUNT + 1;

// Per-volume rhythm so no two volumes breathe in sync
const F = [1.0, 0.83, 1.17, 0.91, 1.09, 0.78, 1.23, 0.95, 1.12, 1];
const G = [1.13, 0.94, 0.87, 1.21, 1.02, 1.15, 0.89, 1.07, 0.97, 1];
const PH = Array.from({ length: COUNT }, (_, i) => i * 2.11 + (i % 3) * 0.9);
const PS = Array.from({ length: COUNT }, (_, i) => i * 1.37 + 0.4);

const rad = (d: number) => (d * Math.PI) / 180;
const ringMode = (m: AgentMode) => m === "idle" || m === "hover";

/**
 * Two springs per volume. Position is near-critically damped, so bubbles glide
 * without jitter; radius is underdamped, so they inflate with a soft "pop".
 */
function springFor(mode: AgentMode, pressed: boolean, birth: boolean) {
  if (pressed) return { k: 90, c: 15, kr: 220, cr: 9 };
  // Buds leave the mother briskly but still glide; their size pops
  if (birth && (mode === "idle" || mode === "hover")) return { k: 62, c: 13.5, kr: 150, cr: 6.5 };
  if (mode === "idle" || mode === "hover") return { k: 30, c: 9.5, kr: 70, cr: 5.5 };
  if (mode === "processing" || mode === "emit") return { k: 200, c: 24, kr: 240, cr: 28 };
  return { k: 110, c: 19, kr: 170, cr: 24 };
}

function baseMass(i: number) {
  if (i === SAT) return 0.7;
  if (i >= RING.length) return 0.45; // droplets are quick
  return Math.min(1.5, Math.max(0.55, Math.pow(RING[i].r / 30, 1.25)));
}

/**
 * Living ring: volumes slide along it, breathe, and trade material through droplets.
 * `b` scales every time-based motion (the breath): 1 is v0's ring, 0 the still ring of the reference.
 */
function ringHome(i: number, t: number, a: Vec, sc: number, hover: boolean, pressed: boolean, b: number): Circle {
  // Each oscillation is written as `b * amplitude * sin(…)`: at b = 1 it is bit-for-bit v0's expression
  if (i < RING.length) {
    const base = RING[i];
    const R = RING_R * sc * (pressed ? 0.86 : hover ? 0.95 : 1);
    const th = rad(base.a) + b * rad(10) * Math.sin(0.17 * t * F[i] + PH[i]) + b * rad(4) * Math.sin(0.36 * t * G[i] + PS[i]);
    const Ri = R * (1 + b * 0.045 * Math.sin(0.27 * t * F[i] + PH[i] * 1.7));
    const r = base.r * sc * (pressed ? 1.07 : hover ? 1.04 : 1) * (1 + b * 0.06 * Math.sin(0.24 * t * G[i] + PS[i]));
    return { cx: a.x + Math.cos(th) * Ri, cy: a.y + Math.sin(th) * Ri, r };
  }
  const j = i - RING.length;
  if (hover || pressed) {
    // Droplets gather in the centre and fuse into the nucleus
    const wob = b * Math.sin(1.3 * t + j * Math.PI) * 1.5 * sc;
    return { cx: a.x + (j ? 6 : -6) * sc + wob, cy: a.y - wob * 0.5, r: (pressed ? 17 : 15) * sc };
  }
  const d = DROPS[j];
  const th = rad(d.a) + b * rad(28) * Math.sin(0.14 * t * F[i] + PH[i]);
  const R = RING_R * sc * (1 + b * 0.06 * Math.sin(0.41 * t + PS[i]));
  return { cx: a.x + Math.cos(th) * R, cy: a.y + Math.sin(th) * R, r: d.r * sc * (1 + b * 0.08 * Math.sin(0.6 * t + PH[i])) };
}

interface Live {
  mode: AgentMode;
  anchor: Vec;
  scale: number;
  targets: Circle[];
  satellite: Circle;
  pressed: boolean;
  reduced: boolean;
  rest: boolean;
}

/**
 * Where volume `i` rests now. `still` is reduced motion: the ring at t = 0 and no ambient motion,
 * as v0 drew it. Particles before `i` are already updated (the ring's satellite follows volume 3).
 */
function homeFor(i: number, ps: Particle[], t: number, b: number, live: Live, still: boolean): Circle {
  const { mode: m, anchor: a, scale: sc, targets: tg, satellite: sat, pressed: pr } = live;
  // At rest the satellite hides inside its host volume; in the composer it becomes "close"
  if (i === SAT) return ringMode(m) ? { cx: ps[3].x, cy: ps[3].y, r: ps[3].r * 0.7 } : sat;
  if (ringMode(m)) return ringHome(i, still ? 0 : t, a, sc, m === "hover", pr, still ? 1 : b);
  const home = tg[i];
  if ((m === "processing" || m === "emit") && i < 3 && !still) {
    // Outer volumes separate from and reconnect with the core
    const s = Math.sin(t * 7.2 + (i === 2 ? Math.PI : 0));
    return { cx: home.cx + (i === 1 ? 0 : (i === 0 ? -1 : 1) * (6 + 8 * s)), cy: home.cy, r: home.r * (i === 1 ? 1 + 0.06 * Math.sin(t * 14.4) : 1) };
  }
  if (m === "compact" && i === 0 && !still) return { ...home, r: home.r * (1 + b * 0.025 * Math.sin(t * 1.6)) };
  return home;
}

/** On a mode change, release volumes in a meaningful order so the shape streams rather than jumps. */
function retarget(ps: Particle[], from: AgentMode, mode: AgentMode, now: number, targets: Circle[], anchor: Vec) {
  const order = (key: (i: number) => number, step: number) => {
    const idx = Array.from({ length: BLOB_COUNT }, (_, i) => i).sort((a, b) => key(a) - key(b));
    idx.forEach((i, rank) => (ps[i].release = now + rank * step));
    return (BLOB_COUNT - 1) * step;
  };

  let last: number;
  if (mode === "input" && ringMode(from)) last = order((i) => targets[i].cx, 0.026);
  else if (ringMode(mode)) last = order((i) => Math.hypot(ps[i].x - anchor.x, ps[i].y - anchor.y), 0.022);
  else if (mode === "processing" || mode === "emit") last = order((i) => i, 0.012);
  else last = order((i) => targets[i].cx, 0.012);

  // The satellite detaches last when the composer opens
  ps[SAT].release = now + (mode === "input" ? last + 0.05 : 0);
  // Until released, each volume holds where it is
  for (const p of ps) {
    p.hx = p.x;
    p.hy = p.y;
    p.hr = p.r;
    p.kick = 0;
  }
}

/** Writes a volume to its ellipse: stretched a whisper along fast motion, as v0 drew it. */
function draw(el: SVGEllipseElement, p: Particle) {
  const r = Math.max(0, p.r);
  const speed = Math.hypot(p.vx, p.vy);
  // Bubbles stay round: only a whisper of stretch along fast motion
  const st = 1 + Math.min(0.14, speed / 1600);
  el.setAttribute("cx", p.x.toFixed(2));
  el.setAttribute("cy", p.y.toFixed(2));
  el.setAttribute("rx", (r * st).toFixed(2));
  el.setAttribute("ry", (r / Math.sqrt(st)).toFixed(2));
  el.setAttribute("transform", `rotate(${((Math.atan2(p.vy, p.vx) * 180) / Math.PI).toFixed(1)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
}

function drawAll(els: (SVGEllipseElement | null)[], ps: Particle[]) {
  for (let i = 0; i < COUNT; i++) {
    const el = els[i];
    if (el) draw(el, ps[i]);
  }
}

const circleKey = (c: Circle) => `${c.cx},${c.cy},${c.r}`;

export function Fluid({ mode, anchor, scale, targets, satellite, pressed, reduced, rest }: Props) {
  const els = useRef<(SVGEllipseElement | null)[]>([]);
  const birthEnd = useRef(0);
  const pointer = useRef<{ x: number; y: number; vx: number; vy: number; t: number } | null>(null);
  const live = useRef<Live>({ mode, anchor, scale, targets, satellite, pressed, reduced, rest });
  /** Breath level, 0 to 1 (Q29); its eased value scales the ambient motion */
  const breath = useRef(1);
  /** Clock time (s) of the last input: a prop change or a pointer near the agent */
  const lastInput = useRef(0);
  /** Clock time (s) since which every volume has been settled, or null */
  const calmSince = useRef<number | null>(null);

  useLayoutEffect(() => {
    live.current = { mode, anchor, scale, targets, satellite, pressed, reduced, rest };
  });

  // Particles are simulation state, mutated every frame — never React state
  const particles = useRef<Particle[] | null>(null);

  // Props by value: AgentLayer hands over fresh objects on every render, and only a real change wakes the loop
  const key = `${mode}|${pressed}|${rest}|${scale}|${anchor.x},${anchor.y}|${circleKey(satellite)}|${targets.map(circleKey).join(";")}`;

  const loop = useSettlingLoop(
    (ms, deltaMs) => {
      const ps = particles.current;
      if (!ps) return false;
      const l = live.current;
      // Reduced motion writes the homes from an effect; a frame already queued has nothing to do
      if (l.reduced) return true;
      const { mode: m, anchor: a, scale: sc, pressed: pr } = l;
      const t = ms / 1000;
      const dtFrame = Math.min(1 / 30, Math.max(1 / 240, deltaMs / 1000));
      const ring = ringMode(m);
      const { k, c, kr, cr } = springFor(m, pr, t < birthEnd.current);

      // Q29: away from rest, or within 4 s of an input, the material breathes; otherwise the breath fades
      breath.current = nextBreath(breath.current, !l.rest || t - lastInput.current < BREATH.idle ? 1 : 0, dtFrame);
      const b = breathAmplitude(breath.current);

      // Pointer decays when it stops moving
      const pt = pointer.current;
      if (pt && performance.now() / 1000 - pt.t > 0.05) {
        pt.vx *= 0.85;
        pt.vy *= 0.85;
      }
      // Its pull fades out at the edge of the wake radius, so a pointer that can't wake the loop can't hold the material
      const reach = ring && pt && !pr ? pointerReach(Math.hypot(pt.x - a.x, pt.y - a.y), sc) : 0;
      /** The pointer's pull on a volume at (x, y), as an acceleration */
      const pull = (x: number, y: number) => {
        if (!pt || reach === 0) return null;
        const dx = pt.x - x;
        const dy = pt.y - y;
        const d = Math.hypot(dx, dy) || 1;
        // At full reach this is v0's falloff, bit for bit
        const fall = reach * Math.exp(-((d / (INFLUENCE * sc)) ** 2));
        return { dx, dy, d, fall };
      };

      const homes: Circle[] = [];
      for (let i = 0; i < COUNT; i++) {
        const p = ps[i];
        let home: Circle;
        if (t < p.release) home = { cx: p.hx, cy: p.hy, r: p.hr };
        else if (p.kick && i < RING.length) {
          // Birth swirl: leave the mother on a gentle clockwise arc
          const th = rad(RING[i].a);
          p.vx += -Math.sin(th) * p.kick;
          p.vy += Math.cos(th) * p.kick;
          p.kick = 0;
          home = ringHome(i, t, a, sc, m === "hover", pr, b);
        } else home = homeFor(i, ps, t, b, l, false);
        homes.push(home);

        // Two sub-steps keep the stiffer transition springs stable
        const dt = dtFrame / 2;
        for (let s = 0; s < 2; s++) {
          let fx = 0;
          let fy = 0;
          const f = ring && i !== SAT ? pull(p.x, p.y) : null;
          if (f) {
            // Surface tension reaches softly toward the hand…
            fx += (f.dx / f.d) * 380 * f.fall;
            fy += (f.dy / f.d) * 380 * f.fall;
            // …and a moving hand nudges the material in its wake
            p.vx += pt!.vx * 0.45 * f.fall * dt;
            p.vy += pt!.vy * 0.45 * f.fall * dt;
          }
          const ax = (k * (home.cx - p.x) - c * p.vx) / p.m + fx;
          const ay = (k * (home.cy - p.y) - c * p.vy) / p.m + fy;
          p.vx += ax * dt;
          p.vy += ay * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const ar = (kr * (home.r - p.r) - cr * p.vr) / p.m;
          p.vr += ar * dt;
          p.r += p.vr * dt;
        }
      }

      // Settled (plan §9.1): only at rest, with the breath gone and every volume released, slow and
      // where its springs and the pointer's pull balance (its home, when no pointer is near)
      let calm = l.rest && breath.current === 0 && t >= birthEnd.current;
      const offsets: [number, number][] = [];
      for (let i = 0; calm && i < COUNT; i++) {
        const p = ps[i];
        const home = homes[i];
        const f = ring && i !== SAT ? pull(p.x, p.y) : null;
        // Displacement of the balance point from the home: the pull over the spring's stiffness
        const ox = f ? ((f.dx / f.d) * 380 * f.fall * p.m) / k : 0;
        const oy = f ? ((f.dy / f.d) * 380 * f.fall * p.m) / k : 0;
        offsets.push([ox, oy]);
        calm =
          t >= p.release &&
          Math.hypot(p.vx, p.vy) < REST.speed &&
          Math.abs(p.vr) < REST.radiusSpeed &&
          Math.hypot(home.cx + ox - p.x, home.cy + oy - p.y) < REST.distance &&
          Math.abs(home.r - p.r) < REST.distance;
      }
      if (!calm) calmSince.current = null;
      else if (calmSince.current === null) calmSince.current = t;
      const settled = calmSince.current !== null && t - calmSince.current >= REST.hold;

      if (settled) {
        // Snap to rest: the next write is the last until something wakes the loop
        for (let i = 0; i < COUNT; i++) {
          const p = ps[i];
          // The satellite's home follows volume 3, snapped just before it
          const home = i === SAT ? homeFor(SAT, ps, t, b, l, false) : homes[i];
          const [ox, oy] = offsets[i];
          p.x = ox ? home.cx + ox : home.cx;
          p.y = oy ? home.cy + oy : home.cy;
          p.r = home.r;
          p.vx = p.vy = p.vr = 0;
        }
        calmSince.current = null;
      }
      drawAll(els.current, ps);
      return settled;
    },
    { awake: key, enabled: !reduced },
  );

  // Birth: a mother bubble inflates at the centre, then bubbles bud off it one by one,
  // clockwise, with a slight swirl. Finally the mother divides into the two droplets.
  useLayoutEffect(() => {
    const { anchor: a, scale: sc, reduced: rm } = live.current;
    const t0 = loop.time() / 1000;
    const BUD = 0.085;
    const budsDone = 0.4 + RING.length * BUD;
    birthEnd.current = rm ? 0 : t0 + budsDone + 1.1;
    // The breath lasts its 4 s from the end of the birth
    lastInput.current = birthEnd.current;
    particles.current = Array.from({ length: COUNT }, (_, i) => {
      const drop = i >= RING.length && i !== SAT;
      const off = drop ? (i === RING.length ? -3 : 3) * sc : 0;
      return {
        x: a.x + off,
        y: a.y,
        vx: 0,
        vy: 0,
        r: 0,
        vr: 0,
        m: baseMass(i),
        release: rm ? 0 : t0 + (i < RING.length ? 0.4 + i * BUD : drop ? budsDone + 0.12 : 0),
        hx: a.x + off,
        hy: a.y,
        hr: drop ? 27 * sc : 0,
        kick: rm || i >= RING.length ? 0 : 95 * sc,
      };
    });
  }, [loop]);

  // Reduced motion: no loop, a still SVG. The homes are written once per change, as v0's reduced-motion rest drew them
  useLayoutEffect(() => {
    const ps = particles.current;
    if (!reduced || !ps) return;
    for (let i = 0; i < COUNT; i++) {
      const p = ps[i];
      const home = homeFor(i, ps, 0, 1, live.current, true);
      p.x = home.cx;
      p.y = home.cy;
      p.r = home.r;
      p.vx = p.vy = p.vr = 0;
      p.release = 0;
      p.kick = 0;
    }
    drawAll(els.current, ps);
  }, [reduced, key]);

  // A prop change is an input: the material breathes again for 4 s (the change itself wakes the loop)
  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    lastInput.current = loop.time() / 1000;
  }, [key, loop]);

  // Mode change: volumes are released in a meaningful order, so the shape streams rather than jumps
  const prevMode = useRef(mode);
  useEffect(() => {
    const from = prevMode.current;
    prevMode.current = mode;
    const ps = particles.current;
    if (!ps || from === mode || reduced) return;
    if (ringMode(from) && ringMode(mode)) return; // idle ↔ hover is continuous

    retarget(ps, from, mode, loop.time() / 1000, targets, anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    // Whether the pointer was near the agent at its last event: leaving must wake the material too
    let near = false;
    const onMove = (e: PointerEvent) => {
      const now = performance.now() / 1000;
      const prev = pointer.current;
      if (prev && now > prev.t) {
        const dt = Math.max(1 / 240, now - prev.t);
        const k = 0.35; // velocity smoothing
        pointer.current = {
          x: e.clientX,
          y: e.clientY,
          vx: prev.vx * (1 - k) + ((e.clientX - prev.x) / dt) * k,
          vy: prev.vy * (1 - k) + ((e.clientY - prev.y) / dt) * k,
          t: now,
        };
      } else pointer.current = { x: e.clientX, y: e.clientY, vx: 0, vy: 0, t: now };

      // Q29: a pointer moving near the agent is an input, and wakes it within a frame
      const { anchor: a, scale: sc } = live.current;
      const wasNear = near;
      near = nearAnchor(e.clientX, e.clientY, a, sc);
      if (!near && !wasNear) return;
      lastInput.current = loop.time() / 1000;
      loop.wake();
    };
    const onLeave = () => {
      pointer.current = null;
      if (!near) return;
      near = false;
      loop.wake();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [loop]);

  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <ellipse key={i} ref={(el) => void (els.current[i] = el)} rx={0} ry={0} />
      ))}
    </>
  );
}
