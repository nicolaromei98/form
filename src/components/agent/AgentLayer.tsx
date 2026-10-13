"use client";

import { AnimatePresence, animate, motion, useMotionValue, useTransform, type Transition } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useForm, type Rect } from "@/lib/store";
import { CREATE, TAB_GROW_MS, ease, springs } from "@/lib/motion";
import { useViewport } from "@/lib/useViewport";
import { NODE, agentScale, agentShape, compactFrame, composerFrame, nodeFrames, type AgentMode, type Capsule, type Vec } from "./geometry";
import { Fluid } from "./Fluid";
import { IdleCaption } from "./IdleCaption";
import { Composer } from "./Composer";
import { CompactPill } from "./CompactPill";
import { Caption } from "./Caption";
import { NODE_TIMING, NodeBlobs, NodeLabels } from "./ViewNodes";
import { VIEW_OFFER } from "./suggestions";
import { nextViews } from "@/lib/views";

export function AgentLayer() {
  const { w: vw, h: vh } = useViewport();
  const hasTool = useForm((s) => !!s.doc.tool);
  const composerOpen = useForm((s) => s.composerOpen);
  const phase = useForm((s) => s.phase);
  const spawn = useForm((s) => s.spawn);
  const fxSeq = useForm((s) => s.fx.seq);
  const reduced = useForm((s) => s.reducedMotion);
  const openComposer = useForm((s) => s.openComposer);
  const submit = useForm((s) => s.submit);
  const intro = useForm((s) => s.intro);
  // Nodes only speak when nothing else is being decided: no selection, proposal or plan
  const quiet = useForm((s) => !s.selectedId && !s.doc.proposal && !s.doc.plan);
  const views = useForm((s) => s.doc.tool?.views);
  const offers = useMemo(() => nextViews(views), [views]);
  const [nodeHover, setNodeHover] = useState<number | null>(null);
  // A different set of offers (a view added, undone or redone) folds the nodes back into the agent
  // before the new ones bud: nodes never slide into each other's places or sit there unlabelled
  const offersKey = offers.join();
  const [budKey, setBudKey] = useState(offersKey);
  useEffect(() => {
    if (budKey === offersKey) return;
    const t = setTimeout(() => setBudKey(offersKey), reduced ? 0 : NODE_TIMING.retract * 1000);
    return () => clearTimeout(t);
  }, [budKey, offersKey, reduced]);

  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [settledSeq, setSettledSeq] = useState(-1);

  // During creation the body stays at the origin while volumes leave, then docks
  useEffect(() => {
    if (phase !== "creating") return;
    const t = setTimeout(() => setSettledSeq(fxSeq), (CREATE.lead + CREATE.travel * 0.75) * 1000);
    return () => clearTimeout(t);
  }, [phase, fxSeq]);
  const emitting = phase === "creating" && settledSeq !== fxSeq;

  let mode: AgentMode;
  if (phase === "processing") mode = "processing";
  else if (phase === "creating") mode = emitting ? "emit" : "compact";
  else if (composerOpen) mode = "input";
  else if (hasTool) mode = "compact";
  else mode = hover ? "hover" : "idle";

  const center: Vec = { x: vw / 2, y: Math.round(vh / 2 - 8) };
  const dock: Vec = { x: vw / 2, y: vh - 54 };
  const anchor: Vec = mode === "emit" || !hasTool ? center : mode === "input" || mode === "processing" ? { x: dock.x, y: dock.y - 8 } : dock;

  const shape = agentShape(mode, anchor, vw, hasTool && mode !== "emit");
  const sc = agentScale(vw);

  const bodyT: Transition = reduced
    ? { duration: 0 }
    : // From the idle ring, the capsule fills in only after the volumes have started streaming into line
      { ...springs.pill, delay: mode === "input" && !hasTool ? 0.14 : 0 };

  const showHit = mode === "idle" || mode === "hover";

  // Views to create next, budding off the docked agent once it has settled
  const nodes = nodeFrames(dock, vw, offers);
  const nodesShown = mode === "compact" && phase === "rest" && !intro && quiet && budKey === offersKey && nodes.frames.length > 0;
  // Nodes that leave under the pointer never get a pointerleave: forget the hover with them
  if (!nodesShown && nodeHover !== null) setNodeHover(null);
  // Away from the pill they fold back into the agent's body wherever it is now
  const nodeOrigin = mode === "compact" ? nodes.origin : { x: dock.x, y: dock.y - 8 };

  return (
    <>
      <svg className="pointer-events-none fixed inset-0 z-40" width={vw} height={vh} aria-hidden>
        <defs>
          <filter id="form-goo" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8.5" result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 34 -15" />
          </filter>
        </defs>
        <g filter="url(#form-goo)" fill="var(--ink)">
          <Body target={shape.body} transition={bodyT} />
          <Fluid mode={mode} anchor={anchor} scale={sc} targets={shape.blobs} satellite={shape.satellite} pressed={pressed} reduced={reduced} />
          <NodeBlobs frames={nodes.frames} origin={nodeOrigin} shown={nodesShown} hovered={nodeHover} reduced={reduced} />
          {phase === "creating" &&
            spawn?.map((r, i) => <SpawnBlob key={`${fxSeq}-${i}`} origin={center} rect={r} index={i} />)}
        </g>
      </svg>

      {/* Idle / hover hit area */}
      {showHit && (
        <button
          type="button"
          aria-label="Open FORM — describe what you need"
          className="focus-ring fixed z-50 cursor-pointer rounded-full"
          style={{ left: center.x - 120 * sc, top: center.y - 120 * sc, width: 240 * sc, height: 240 * sc }}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => {
            setHover(false);
            setPressed(false);
          }}
          // Press gathers the material (anticipation); release lets it burst into the composer
          onPointerDown={() => setPressed(true)}
          onPointerCancel={() => setPressed(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          onClick={() => {
            setHover(false);
            setPressed(false);
            openComposer();
          }}
        />
      )}

      {/* Integrated interaction detail: "• →" inside the nucleus (PXDX) */}
      <AnimatePresence>
        {mode === "hover" && (
          <motion.div
            key="arrow"
            className="pointer-events-none fixed z-50 flex items-center justify-center gap-[5px] text-on-ink"
            style={{ left: center.x - 20, top: center.y - 20, width: 40, height: 40 }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, transition: { delay: 0.08, ...springs.snappy } }}
            exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.12 } }}
          >
            <span className="block h-[3px] w-[3px] rounded-full bg-on-ink" />
            <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden>
              <path d="M1 5h10.5M7.5 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle caption */}
      <AnimatePresence>
        {(mode === "idle" || mode === "hover") && <IdleCaption key="idle-caption" left={center.x} top={center.y + 150 * sc} reduced={reduced} />}
      </AnimatePresence>

      <Composer
        open={mode === "input"}
        frame={composerFrame(anchor, vw)}
        placement={hasTool ? "dock" : "center"}
      />

      {/* Hovering a node, the pill speaks the command the node will send */}
      <CompactPill
        visible={mode === "compact" && phase === "rest"}
        frame={compactFrame(dock)}
        hint={nodesShown && nodeHover !== null && nodes.frames[nodeHover] ? VIEW_OFFER[nodes.frames[nodeHover].view] : null}
      />

      <NodeLabels
        frames={nodes.frames}
        shown={nodesShown}
        reduced={reduced}
        onHover={setNodeHover}
        // The same path as typing it: the agent takes it in, answers with a caption, and Undo removes the view
        onPick={(view, keyboard) =>
          // Canned phrases the demo parser routes: deterministic and immediate on any engine
          void submit(VIEW_OFFER[view], { engine: "demo" }).then((ok) => {
            // Keyboard users land on the new tab once it has grown
            if (!ok || !keyboard) return;
            setTimeout(() => {
              // Only if focus went nowhere (the node unmounted): never pull it out of the composer
              if (document.activeElement && document.activeElement !== document.body) return;
              document.querySelector<HTMLElement>(`[data-rep-tab="${view}"]`)?.focus({ preventScroll: true });
            }, TAB_GROW_MS);
          })
        }
      />

      {/* On phones the nodes sit above the pill: the caption rises to clear them */}
      <Caption anchor={hasTool ? dock : center} placement={hasTool ? "dock" : "center"} composerOpen={mode === "input"} lift={nodesShown && nodes.layout === "row" ? NODE.h + NODE.rowGap - 2 : 0} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Body({ target, transition }: { target: Capsule; transition: Transition }) {
  const x = useMotionValue(target.x);
  const y = useMotionValue(target.y);
  const w = useMotionValue(target.w);
  const h = useMotionValue(target.h);
  useEffect(() => {
    const a = [animate(x, target.x, transition), animate(y, target.y, transition), animate(w, target.w, transition), animate(h, target.h, transition)];
    return () => a.forEach((v) => v.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.w, target.h]);
  // Springs overshoot when the capsule collapses to nothing; SVG rejects negative sizes
  const W = useTransform(() => Math.max(0, w.get()));
  const H = useTransform(() => Math.max(0, h.get()));
  const rx = useTransform(() => Math.max(0, h.get() / 2));
  return <motion.rect x={x} y={y} width={W} height={H} rx={rx} />;
}

/** A volume that leaves the agent and becomes a task surface. */
function SpawnBlob({ origin, rect, index }: { origin: Vec; rect: Rect; index: number }) {
  const r0 = 26;
  const cr = Math.max(22, Math.min(40, Math.min(rect.w, rect.h) * 0.24));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.min(28, rect.h / 2);
  const delay = CREATE.lead + index * CREATE.stagger;
  const total = CREATE.travel + CREATE.expand;
  const times = [0, CREATE.travel / total, 1];
  const t: Transition = { duration: total, delay, times, ease: [ease.out, ease.inOut] };
  return (
    <motion.rect
      initial={{ x: origin.x - r0, y: origin.y - r0, width: r0 * 2, height: r0 * 2, rx: r0, opacity: 1 }}
      animate={{
        x: [origin.x - r0, cx - cr, rect.x],
        y: [origin.y - r0, cy - cr, rect.y],
        width: [r0 * 2, cr * 2, rect.w],
        height: [r0 * 2, cr * 2, rect.h],
        rx: [r0, cr, radius],
        opacity: [1, 1, 1, 0],
      }}
      transition={{
        x: t,
        y: t,
        width: t,
        height: t,
        rx: t,
        opacity: { duration: total + 0.06, delay, times: [0, 0.5, 0.999, 1], ease: "linear" },
      }}
    />
  );
}
