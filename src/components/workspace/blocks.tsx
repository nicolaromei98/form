"use client";

import { AnimatePresence, LayoutGroup, motion, useIsPresent } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { DecodeText, RevealText, revealWords } from "../text/TextMotion";
import { SORT_LABEL, VIEW_LABEL } from "@/lib/domain/labels";
import { PROJECT_TITLE } from "@/lib/domain/limits";
import { formatMoney } from "@/lib/domain/money";
import type { TaskId } from "@/lib/domain/schema/ids";
import type { SortKey, ViewKind } from "@/lib/domain/schema/primitives";
import type { ViewConfig } from "@/lib/domain/schema/project";
import { fmtDate } from "@/lib/planning/format";
import {
  useActions,
  useActiveView,
  useFx,
  useMetrics,
  usePlan,
  useProject,
  useReducedMotion,
  useTask,
  useTaskIds,
  useViewConfig,
  useViews,
} from "@/lib/store/hooks";
import { TAB_GROW_MS, ease, move } from "@/lib/motion";
import { EditableText, Popover, usePopover } from "./parts";
import { useBlockReveal } from "./reveal";
import { CardsView } from "./CardsView";
import { BoardView } from "./BoardView";
import { TimelineView } from "./TimelineView";
import { FocusView } from "./FocusView";
import { TeamView } from "./TeamView";
import { BriefView } from "./BriefView";
import { ShuffleText } from "../text/ShuffleText";

/* ------------------------------------------------------------------
   Block shell — every registry block enters the same way
   ------------------------------------------------------------------ */

export function BlockShell({ children, className = "", order = 0 }: { children: ReactNode; className?: string; order?: number }) {
  const reveal = useBlockReveal();
  // Same motion as text everywhere: condense out of a blur, no travel
  return (
    <motion.section
      layout="position"
      className={className}
      initial={{ opacity: 0, filter: "blur(12px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, filter: "blur(10px)", transition: { duration: 0.3 } }}
      transition={{ duration: 0.9, ease: ease.out, delay: reveal != null ? reveal + order * 0.07 : 0.07 + order * 0.07 }}
    >
      {children}
    </motion.section>
  );
}

/* ------------------------------------------------------------------
   Header — title, view tabs, live view config
   ------------------------------------------------------------------ */

export function HeaderBlock() {
  const project = useProject();
  const m = useMetrics();
  const rep = useActiveView();
  const { commit } = useActions();
  const reveal = useBlockReveal();
  if (project === null || m === null) return null;

  const d = reveal ?? 0.05;
  // "sample start" until the user confirms a start (plan §8.2); without a start date the subtitle says nothing about it
  const start = project.startDate === null ? "" : ` · ${project.startConfirmed ? "starts" : "sample start"} ${fmtDate(project.startDate)}`;
  const subtitle = `${m.count} tasks${m.missingEstimates > 0 ? ` · ${m.missingEstimates} without duration` : ""}${start}`;

  // Focus is a stage: the header steps down to a single line so the decision owns the viewport
  if (rep === "focus") {
    return (
      <BlockShell className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <DecodeText text="Focus" delay={d} className="t-meta text-text-3" />
          <RevealText text={project.title} delay={d + 0.1} className="t-body truncate text-text-2" />
        </div>
        <RepresentationSwitch />
      </BlockShell>
    );
  }

  return (
    <BlockShell className="mb-7 flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
      <div className="min-w-0">
        {/* The eyebrow re-decodes whenever the view changes */}
        <DecodeText text={`Project · ${VIEW_LABEL[rep]}`} delay={d} className="t-meta mb-3 block text-text-3" />
        <TitleReveal delay={d + 0.08}>
          <EditableText
            value={project.title}
            label="Project title"
            maxLength={PROJECT_TITLE}
            onCommit={(v) => commit([{ op: "updateProject", field: "title", value: v }], { label: "rename project" })}
            className="t-display-l tone-light"
          />
        </TitleReveal>
        <RevealText as="p" text={subtitle} delay={d + 0.3} className="t-body mt-3 text-text-2" />
      </div>
      <div className="flex flex-col items-start gap-3 md:items-end">
        <RepresentationSwitch />
        <ViewControls />
      </div>
    </BlockShell>
  );
}

/** Condenses an editable title word by word on mount, then restores it for editing. */
function TitleReveal({ delay, children }: { delay: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      const el = ref.current?.querySelector("[contenteditable]");
      if (el && !reduced) revealWords(el, { delay });
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className="pb-1">
      {children}
    </div>
  );
}

/** Last change whose new tab already grew, so a remount (focus header) never holds the ink again */
let grownSeq = -1;

/** A created view's tab growing in, and the tab the ink waits on meanwhile */
interface Hold {
  view: ViewKind;
  from: ViewKind;
  seq: number;
}

// memo: HeaderBlock re-renders on every project change, which must not interrupt a growing tab
const RepresentationSwitch = memo(function RepresentationSwitch() {
  // The tab on screen is local (Q6): switching tabs is no command and no history entry
  const rep = useActiveView();
  const views = useViews();
  const fx = useFx();
  const reduced = useReducedMotion();
  const { showView } = useActions();
  const listRef = useRef<HTMLDivElement>(null);
  // Only the views this project has, in creation order; the current one is a safety net
  const tabs = views.includes(rep) ? views : [...views, rep];
  // The ink waits on the previous tab while the new one grows, then slides over — never onto a box
  // still opening. The hold belongs to the growth: a toggle or an edit during it doesn't cut it short.
  const fresh: Hold | null = !reduced && fx.added && fx.from && fx.added !== fx.from && fx.seq !== grownSeq ? { view: fx.added, from: fx.from, seq: fx.seq } : null;
  const [hold, setHold] = useState<Hold | null>(fresh);
  if (fresh && fresh.seq !== hold?.seq) setHold(fresh);
  useEffect(() => {
    if (!hold) return;
    const t = setTimeout(() => {
      grownSeq = hold.seq;
      setHold(null);
    }, TAB_GROW_MS);
    return () => clearTimeout(t);
  }, [hold]);
  // Held only while the created view is on screen and the tab the ink waits on still exists
  const pill = hold && hold.view === rep && views.includes(hold.from) ? hold.from : rep;
  // A new tab past the edge of a scrolling tab bar (phones) scrolls into view as it grows
  useEffect(() => {
    if (!fx.added) return;
    const list = listRef.current;
    if (list && list.scrollWidth > list.clientWidth) list.scrollTo({ left: list.scrollWidth, behavior: "smooth" });
  }, [fx.added, fx.seq]);

  return (
    <LayoutGroup id="rep-switch">
      <div ref={listRef} role="tablist" aria-label="Views" className="glass no-scrollbar flex h-[44px] max-w-full items-center overflow-x-auto rounded-full p-1">
        {/* initial={false}: the tabs a header mounts with are just there; every tab added later grows in */}
        <AnimatePresence initial={false}>
          {tabs.map((r) => (
            <ViewTab key={r} view={r} selected={rep === r} inked={pill === r} reduced={reduced} onPick={showView} />
          ))}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
});

function ViewTab({ view, selected, inked, reduced, onPick }: { view: ViewKind; selected: boolean; inked: boolean; reduced: boolean; onPick: (v: ViewKind) => void }) {
  // A closing tab renders with its last props: it drops the ink at once so the ink slides to the neighbour
  const present = useIsPresent();
  const ink = inked && present;
  return (
    <button
      role="tab"
      type="button"
      aria-selected={selected && present}
      data-rep-tab={view}
      onClick={() => onPick(view)}
      className={`focus-ring t-body-s relative h-full shrink-0 cursor-pointer rounded-full transition-colors duration-300 ${ink ? "text-on-ink" : "text-text-2 hover:text-text"} ${present ? "" : "pointer-events-none"}`}
    >
      {ink && <motion.span layoutId="rep-active" className="absolute inset-0 rounded-full bg-ink" transition={move} />}
      {/* Real width, not scale: the glass capsule widens with the tab and nothing stretches.
          Only the label is clipped, so the sliding ink is never cut off */}
      <motion.span
        className="relative flex h-full overflow-hidden"
        initial={{ width: 0 }}
        animate={{ width: "auto" }}
        // A tab holding the ink stays open until the ink has left it; any other closes from where it is
        exit={{ width: 0, transition: reduced ? { duration: 0 } : { ...move, delay: inked ? move.duration : 0 } }}
        transition={reduced ? { duration: 0 } : move}
      >
        {/* The label condenses out of a blur on a child, so the glass keeps its backdrop blur */}
        <motion.span
          className="flex shrink-0 items-center px-2 whitespace-nowrap min-[400px]:px-3 sm:px-4"
          initial={{ opacity: 0, filter: "blur(8px)" }}
          animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: reduced ? 0 : 0.5, ease: ease.out, delay: reduced ? 0 : 0.24 } }}
          exit={{ opacity: 0, filter: "blur(8px)", transition: { duration: reduced ? 0 : 0.24 } }}
        >
          <ShuffleText text={VIEW_LABEL[view]} />
        </motion.span>
      </motion.span>
    </button>
  );
}

/** /demo's sorts: v0's six (the demo can't set due dates until Phase 3) */
const SORTS: readonly SortKey[] = ["manual", "priority", "progress", "status", "title", "estimate"];

/** What the header's controls change: the view options and the brief's length */
type ViewPatch = Partial<Pick<ViewConfig, "sort" | "density" | "hideDone" | "highlightUrgent">> & { briefShort?: boolean };

function ViewControls() {
  const view = useViewConfig();
  const rep = useActiveView();
  const { commit } = useActions();
  const { setAnchor: sortPopAnchor, anchor: sortPopEl, pos: sortPopPos, open: sortPopOpen, toggle: sortPopToggle, close: sortPopClose } = usePopover<HTMLButtonElement>();
  if (view === null) return null;
  // Timeline follows workflow order; focus shows one task — sorting means nothing there
  const timeline = rep === "timeline" || rep === "focus";
  // View options commit and undo, and stay out of Activity (Q6)
  const setView = (patch: ViewPatch, label: string) => commit([{ op: "setView", patch }], { label });

  // The brief is prose: its only control is its length; the task-view toggles would do nothing there
  if (rep === "brief") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Toggle label="Short version" on={view.brief.short} onChange={(v) => setView({ briefShort: v }, v ? "short brief" : "full brief")} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        ref={sortPopAnchor}
        type="button"
        disabled={timeline}
        aria-haspopup="menu"
        aria-expanded={sortPopOpen}
        onClick={sortPopToggle}
        title={timeline ? "Sorting applies to the tracker and the board" : undefined}
        className="focus-ring t-body-s flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full px-2 text-text-3 transition-colors hover:text-text disabled:cursor-default disabled:opacity-40"
      >
        <ShuffleText text="Sort" />
        <span className="text-text">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={view.sort} className="inline-block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              <ShuffleText text={SORT_LABEL[view.sort]} />
            </motion.span>
          </AnimatePresence>
        </span>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="text-text-3">
          <path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <Popover anchor={sortPopEl} pos={sortPopPos} onClose={sortPopClose}>
        <div role="menu" className="flex w-[160px] flex-col">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={view.sort === s}
              onClick={() => {
                if (s !== view.sort) setView({ sort: s }, `sort ${s}`);
                sortPopClose();
              }}
              className={`focus-ring t-body-s h-9 cursor-pointer rounded-full px-3 text-left transition-colors ${view.sort === s ? "bg-ink text-on-ink" : "text-text hover:bg-black/[0.05]"}`}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
      </Popover>

      <Toggle label="Compact" on={view.density === "compact"} onChange={(v) => setView({ density: v ? "compact" : "comfortable" }, "density")} />
      <Toggle label="Hide done" on={view.hideDone} onChange={(v) => setView({ hideDone: v }, "hide done")} />
      <Toggle label="Urgent" on={view.highlightUrgent} onChange={(v) => setView({ highlightUrgent: v }, "highlight")} />
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="focus-ring t-body-s group flex h-[30px] cursor-pointer items-center gap-2 rounded-full px-1.5 text-text-3 transition-colors hover:text-text"
    >
      {/* The off track is a meaningful stroke (Q14): 3:1 against the paper, and the white knob 3.8:1 against it */}
      <span className={`relative h-[15px] w-[26px] rounded-full transition-colors duration-300 ${on ? "bg-ink" : "bg-line-strong"}`}>
        <motion.span
          className="absolute top-[2px] h-[11px] w-[11px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
          initial={false}
          animate={{ left: on ? 13 : 2 }}
          transition={move}
        />
      </span>
      <ShuffleText text={label} className={on ? "text-text" : ""} />
    </button>
  );
}

/* ------------------------------------------------------------------
   Metrics — a circle and chained capsules (Giza search row)
   ------------------------------------------------------------------ */

export function MetricsBlock() {
  const plan = usePlan();
  const tasks = plan?.project.tasks;
  // "Known cost" sums the manual costs, shown once any task has one (v0)
  const costed = useMemo(() => (tasks === undefined ? false : Object.values(tasks).some((t) => t.costCents !== null)), [tasks]);
  if (plan === null) return null;
  const m = plan.metrics;

  // A single slim instrument strip: eyebrow + figure per segment, hairlines between
  return (
    <BlockShell order={1} className="no-scrollbar -mx-4 mb-8 overflow-x-auto px-4 py-1 md:mx-0 md:overflow-visible md:px-0">
      <motion.div layout className="glass inline-flex h-[48px] shrink-0 items-center pr-1.5 pl-1.5" style={{ borderRadius: 999 }} transition={move}>
        <Stat label="Complete" lead={<MiniRing value={m.completePct} />}>
          {m.completePct}
          <span className="text-text-3">%</span>
        </Stat>
        <Stat label="Done">
          {m.done}
          <span className="text-text-3">/{m.count}</span>
        </Stat>
        <Stat label="Estimate">
          {m.totalEstimate}
          <span className="text-text-3">d</span>
        </Stat>
        <Stat label="Urgent" lead={m.urgentOpen > 0 ? <span className="h-[6px] w-[6px] rounded-full bg-signal" /> : undefined}>
          {m.urgentOpen}
        </Stat>
        {m.steps > 0 && <Stat label="Steps">{m.steps}</Stat>}
        {costed && <Stat label="Known cost">{formatMoney(m.budget.knownCents, m.budget.currency)}</Stat>}
      </motion.div>
    </BlockShell>
  );
}

function Stat({ label, lead, children }: { label: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <motion.div layout="position" className="flex h-full items-center gap-2.5 border-l border-line px-4 whitespace-nowrap first:border-l-0 first:pl-1.5">
      {lead}
      <span className="t-micro text-text-3">{label}</span>
      <span className="t-num text-[17px] tracking-[-0.025em]">{children}</span>
    </motion.div>
  );
}

function MiniRing({ value }: { value: number }) {
  const size = 34;
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${value}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(10,10,10,0.08)" strokeWidth="2" fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="var(--ink)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value / 100) }}
        transition={{ ...move, delay: 0.2 }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------
   Progress indicator — added on request ("add a progress indicator")
   ------------------------------------------------------------------ */

export function ProgressBlock() {
  const m = useMetrics();
  // Every task in workflow order (v0 topLevel): the view's filters don't apply to the whole
  const ids = useTaskIds();
  if (m === null) return null;
  return (
    <BlockShell order={2} className="mb-6">
      <div className="glass flex items-center gap-4 rounded-full p-2 pr-3">
        <div className="flex shrink-0 flex-col pl-5">
          <span className="t-micro text-text-3">Progress</span>
          <span className="t-num mt-1.5 text-[28px]">
            {m.completePct}
            <span className="ml-px align-top text-[13px] text-text-3">%</span>
          </span>
        </div>
        <div className="flex h-[48px] min-w-0 flex-1 gap-1">
          {ids.map((id) => (
            <ProgressSegment key={id} id={id} />
          ))}
        </div>
      </div>
      <p className="t-data mt-2.5 pl-6 text-text-3">Segments sized by estimate, filled by progress</p>
    </BlockShell>
  );
}

/** One task's segment: sized by its estimate (unknown counts as 1 day), filled by its progress */
function ProgressSegment({ id }: { id: TaskId }) {
  const t = useTask(id);
  if (t === null) return null;
  return (
    <div className="relative min-w-[28px] overflow-hidden rounded-full bg-black/[0.07]" style={{ flex: t.estimateDays ?? 1 }} title={`${t.title} · ${t.progress}%`}>
      <span className="t-data absolute top-1/2 left-4 hidden -translate-y-1/2 whitespace-nowrap text-text-2 sm:block">{t.title}</span>
      {/* The fill clips an inverted copy of the label, so text stays legible across the edge */}
      <motion.div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-ink"
        initial={{ width: 0 }}
        animate={{ width: `${t.progress}%` }}
        transition={{ ...move, delay: 0.15 }}
      >
        <span className="t-data absolute top-1/2 left-4 hidden -translate-y-1/2 whitespace-nowrap text-on-ink sm:block">{t.title}</span>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Collection — one data set, three representations (ShapeShift)
   ------------------------------------------------------------------ */

const REPRESENTATIONS: Record<ViewKind, () => ReactNode> = {
  cards: CardsView,
  board: BoardView,
  timeline: TimelineView,
  focus: FocusView,
  team: TeamView,
  brief: BriefView,
};

/** Views with their own spatial model: they build themselves instead of morphing task surfaces */
const HANDOVER: readonly ViewKind[] = ["timeline", "team", "brief"];

export function CollectionBlock() {
  const rep = useActiveView();
  const View = REPRESENTATIONS[rep];
  // Cards, board and focus morph into each other through shared surfaces. Timeline and team are
  // different spatial models, so they hand over instead: they draw themselves in, and a view
  // leaving them rises in once they've faded. Each handover starts a new layout scope, so no
  // surface resumes from a box it had before.
  const [shown, setShown] = useState(rep);
  const [handover, setHandover] = useState(false);
  const [scope, setScope] = useState(0);
  if (shown !== rep) {
    setShown(rep);
    setHandover(HANDOVER.includes(shown));
    if (HANDOVER.includes(shown) || HANDOVER.includes(rep)) setScope(scope + 1);
  }
  return (
    <motion.section layout="position" className="relative">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={rep}
          initial={handover ? { opacity: 0, y: 16 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...move, delay: 0.1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
        >
          <LayoutGroup id={`view-${scope}`}>
            <View />
          </LayoutGroup>
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}
