"use client";

import { useAnimationFrame } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { BLOB_COUNT, DROPS, RING, RING_R, type AgentMode, type Circle, type Vec } from "./geometry";

/**
 * FORM's fluid body.
 *
 * Every volume is a damped spring particle with mass. Homes come from the
 * agent geometry; the motion between them is simulated, not tweened — so the
 * material carries inertia, overshoots a little, stretches along its velocity
 * and pinches off. The goo filter on the parent group fuses the result.
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

/** Living ring: volumes slide along it, breathe, and trade material through droplets. */
function ringHome(i: number, t: number, a: Vec, sc: number, hover: boolean, pressed: boolean): Circle {
  if (i < RING.length) {
    const base = RING[i];
    const R = RING_R * sc * (pressed ? 0.86 : hover ? 0.95 : 1);
    const th = rad(base.a) + rad(10) * Math.sin(0.17 * t * F[i] + PH[i]) + rad(4) * Math.sin(0.36 * t * G[i] + PS[i]);
    const Ri = R * (1 + 0.045 * Math.sin(0.27 * t * F[i] + PH[i] * 1.7));
    const r = base.r * sc * (pressed ? 1.07 : hover ? 1.04 : 1) * (1 + 0.06 * Math.sin(0.24 * t * G[i] + PS[i]));
    return { cx: a.x + Math.cos(th) * Ri, cy: a.y + Math.sin(th) * Ri, r };
  }
  const j = i - RING.length;
  if (hover || pressed) {
    // Droplets gather in the centre and fuse into the nucleus
    const wob = Math.sin(1.3 * t + j * Math.PI) * 1.5 * sc;
    return { cx: a.x + (j ? 6 : -6) * sc + wob, cy: a.y - wob * 0.5, r: (pressed ? 17 : 15) * sc };
  }
  const d = DROPS[j];
  const th = rad(d.a) + rad(28) * Math.sin(0.14 * t * F[i] + PH[i]);
  const R = RING_R * sc * (1 + 0.06 * Math.sin(0.41 * t + PS[i]));
  return { cx: a.x + Math.cos(th) * R, cy: a.y + Math.sin(th) * R, r: d.r * sc * (1 + 0.08 * Math.sin(0.6 * t + PH[i])) };
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

export function Fluid({ mode, anchor, scale, targets, satellite, pressed, reduced }: Props) {
  const els = useRef<(SVGEllipseElement | null)[]>([]);
  const clock = useRef(0);
  const birthEnd = useRef(0);
  const pointer = useRef<{ x: number; y: number; vx: number; vy: number; t: number } | null>(null);
  const live = useRef({ mode, anchor, scale, targets, satellite, pressed, reduced });

  useLayoutEffect(() => {
    live.current = { mode, anchor, scale, targets, satellite, pressed, reduced };
  });

  // Particles are simulation state, mutated every frame — never React state
  const particles = useRef<Particle[] | null>(null);

  // Birth: a mother bubble inflates at the centre, then bubbles bud off it one by one,
  // clockwise, with a slight swirl. Finally the mother divides into the two droplets.
  useLayoutEffect(() => {
    const { anchor: a, scale: sc, reduced: rm } = live.current;
    const t0 = clock.current;
    const BUD = 0.085;
    const budsDone = 0.4 + RING.length * BUD;
    birthEnd.current = rm ? 0 : t0 + budsDone + 1.1;
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
  }, []);

  // Mode change: volumes are released in a meaningful order, so the shape streams rather than jumps
  const prevMode = useRef(mode);
  useEffect(() => {
    const from = prevMode.current;
    prevMode.current = mode;
    const ps = particles.current;
    if (!ps || from === mode || reduced) return;
    if (ringMode(from) && ringMode(mode)) return; // idle ↔ hover is continuous

    retarget(ps, from, mode, clock.current, targets, anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
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
    };
    const onLeave = () => (pointer.current = null);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useAnimationFrame((ms, deltaMs) => {
    const ps = particles.current;
    if (!ps) return;
    const { mode: m, anchor: a, scale: sc, targets: tg, satellite: sat, pressed: pr, reduced: rm } = live.current;
    const t = ms / 1000;
    clock.current = t;
    const dtFrame = Math.min(1 / 30, Math.max(1 / 240, deltaMs / 1000));
    const ring = ringMode(m);
    const { k, c, kr, cr } = springFor(m, pr, t < birthEnd.current);

    // Pointer decays when it stops moving
    const pt = pointer.current;
    if (pt && performance.now() / 1000 - pt.t > 0.05) {
      pt.vx *= 0.85;
      pt.vy *= 0.85;
    }

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
        home = ringHome(i, rm ? 0 : t, a, sc, m === "hover", pr);
      }
      else if (i === SAT) {
        // At rest the satellite hides inside its host volume; in the composer it becomes "close"
        home = ring ? { cx: ps[3].x, cy: ps[3].y, r: ps[3].r * 0.7 } : sat;
      } else if (ring) home = ringHome(i, rm ? 0 : t, a, sc, m === "hover", pr);
      else {
        home = tg[i];
        if ((m === "processing" || m === "emit") && i < 3 && !rm) {
          // Outer volumes separate from and reconnect with the core
          const s = Math.sin(t * 7.2 + (i === 2 ? Math.PI : 0));
          home = { cx: home.cx + (i === 1 ? 0 : (i === 0 ? -1 : 1) * (6 + 8 * s)), cy: home.cy, r: home.r * (i === 1 ? 1 + 0.06 * Math.sin(t * 14.4) : 1) };
        } else if (m === "compact" && i === 0 && !rm) {
          home = { ...home, r: home.r * (1 + 0.025 * Math.sin(t * 1.6)) };
        }
      }

      if (rm) {
        p.x = home.cx;
        p.y = home.cy;
        p.r = home.r;
        p.vx = p.vy = p.vr = 0;
      } else {
        // Two sub-steps keep the stiffer transition springs stable
        const dt = dtFrame / 2;
        for (let s = 0; s < 2; s++) {
          let fx = 0;
          let fy = 0;
          if (ring && pt && !pr && i !== SAT) {
            const dx = pt.x - p.x;
            const dy = pt.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            const fall = Math.exp(-((d / (220 * sc)) ** 2));
            // Surface tension reaches softly toward the hand…
            fx += (dx / d) * 380 * fall;
            fy += (dy / d) * 380 * fall;
            // …and a moving hand nudges the material in its wake
            p.vx += pt.vx * 0.45 * fall * dt;
            p.vy += pt.vy * 0.45 * fall * dt;
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

      const el = els.current[i];
      if (!el) continue;
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
  });

  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <ellipse key={i} ref={(el) => void (els.current[i] = el)} rx={0} ry={0} />
      ))}
    </>
  );
}
