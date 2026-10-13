"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useForm } from "@/lib/store";
import { ease, move } from "@/lib/motion";
import { briefHtml, briefPlainText, composeBrief, plainText, type Audience, type Brief, type Sentence } from "@/lib/brief";
import type { Doc } from "@/lib/schema";
import { DecodeText } from "../text/TextMotion";
import { ShuffleText } from "../text/ShuffleText";

/** Stagger for the first reveal, line by line; after that, only changed lines move */
const STEP = 0.06;

/**
 * Representation: brief. The project as a written status update on a sheet of
 * paper — the only view that is prose rather than space. It is recomposed from
 * the document on every change, so it can never drift from the tracker: a
 * sentence whose facts change is rewritten in place, the rest stays still.
 */
export function BriefView() {
  const doc = useForm((s) => s.doc);
  const commit = useForm((s) => s.commit);
  const audience: Audience = doc.view.briefAudience ?? "client";
  const short = doc.view.briefShort ?? false;
  const brief = useMemo(() => composeBrief(doc, audience, short), [doc, audience, short]);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  // Lines condense in one after another on arrival; later rewrites shouldn't wait their turn
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1600);
    return () => clearTimeout(t);
  }, []);

  if (!brief) return null;
  const offsets = sectionOffsets(brief);

  const copy = async () => {
    const ok = await copyBrief(briefPlainText(brief, doc), briefHtml(brief, doc));
    setCopied(ok ? "done" : "failed");
    setTimeout(() => setCopied("idle"), 1800);
  };

  return (
    <motion.article
      className="tone-light relative mx-auto max-w-[780px] rounded-[32px] bg-[#fbfbf9] px-6 py-8 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_0_0_1px_rgba(10,10,10,0.03),0_34px_80px_-46px_rgba(10,10,10,0.4)] md:px-14 md:py-12"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={move}
      aria-label="Status brief"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* One decode per segment, so the eyebrow can wrap between them on a phone */}
        <p className="t-micro flex min-w-0 flex-wrap gap-x-[0.6em] gap-y-1 text-text-3">
          <span className="sr-only">{brief.eyebrow.join(", ")}</span>
          {brief.eyebrow.map((part, i) => (
            <span key={`${i}-${part}`} aria-hidden className="flex gap-x-[0.6em]">
              {i > 0 && <span>·</span>}
              <DecodeText text={part} delay={0.2 + i * 0.08} />
            </span>
          ))}
        </p>
        <div className="flex items-center gap-1.5">
          <AudienceSwitch value={audience} onChange={(a) => commit([{ op: "setView", patch: { briefAudience: a } }], `brief for the ${a}`)} />
          <button
            type="button"
            onClick={copy}
            className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
          >
            <ShuffleText text={copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy"} />
          </button>
        </div>
      </header>

      <h2 className="t-display-l relative mt-10 md:mt-12">
        <Lines sentences={[brief.headline[0]]} slot="h1" from={0} settled={settled} doc={doc} className="block" plainMentions />
        <Lines sentences={[brief.headline[1]]} slot="h2" from={1} settled={settled} doc={doc} className="block text-text-3" plainMentions />
      </h2>

      <div className="mt-8 h-[3px] overflow-hidden rounded-full bg-black/[0.07]">
        <motion.div className="h-full rounded-full bg-ink" initial={{ width: 0 }} animate={{ width: `${brief.progress}%` }} transition={{ ...move, delay: 0.35 }} />
      </div>

      <div className="mt-8 flex flex-col">
        {brief.sections.map((sec) => (
          <motion.section
            key={sec.key}
            layout="position"
            transition={{ layout: move }}
            className="grid gap-x-8 gap-y-2 border-t border-line py-5 md:grid-cols-[136px_minmax(0,1fr)]"
          >
            <span className="t-micro pt-[5px] text-text-3">{sec.label}</span>
            <div className="relative flex flex-col gap-1.5">
              <Lines sentences={sec.sentences} slot={sec.key} from={offsets[sec.key]} settled={settled} doc={doc} className="t-body-l block text-text" />
            </div>
          </motion.section>
        ))}

        {brief.palette.length > 0 && (
          <motion.section
            layout="position"
            transition={{ layout: move }}
            className="grid gap-x-8 gap-y-2 border-t border-line py-5 md:grid-cols-[136px_minmax(0,1fr)]"
          >
            <span className="t-micro pt-[5px] text-text-3">Palette</span>
            <div className="flex flex-wrap gap-1.5">
              {brief.palette.map((hex, i) => (
                <span key={`${hex}-${i}`} title={hex.toUpperCase()} className="h-[26px] w-[26px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" style={{ background: hex }} />
              ))}
            </div>
          </motion.section>
        )}
      </div>

      <motion.p layout="position" transition={{ layout: move }} className="t-data mt-4 border-t border-line pt-5 text-text-3">
        Composed by FORM from the project data. Nothing is invented: what it doesn&rsquo;t know is listed as a question.
      </motion.p>
    </motion.article>
  );
}

/** Where each section's lines start in the reveal order (the two headline lines come first) */
function sectionOffsets(brief: Brief): Record<string, number> {
  return brief.sections.reduce<{ at: number; map: Record<string, number> }>(
    (acc, s) => ({ at: acc.at + s.sentences.length, map: { ...acc.map, [s.key]: acc.at } }),
    { at: 2, map: {} },
  ).map;
}

/** Stable identity of a sentence: who or what it is about, so its wording can change in place */
function subjectOf(sentence: Sentence, index: number) {
  const first = sentence.find((r) => typeof r !== "string");
  if (first && typeof first !== "string") return "task" in first ? `t:${first.task}` : `p:${first.person}`;
  return `i:${index}`;
}

/**
 * A run of sentences. Each is keyed by its subject and wording: unchanged lines keep
 * their element; a line whose facts change dissolves while the new wording condenses
 * into the same place; added or removed lines fade, and the rest glide on the move curve.
 */
function Lines({
  sentences,
  slot,
  from,
  settled,
  doc,
  className,
  plainMentions = false,
}: {
  sentences: Sentence[];
  slot: string;
  from: number;
  settled: boolean;
  doc: Doc;
  className: string;
  /** Headline mentions read as words, not capsules */
  plainMentions?: boolean;
}) {
  return (
    <AnimatePresence mode="popLayout">
      {sentences.map((sentence, i) => (
        <motion.span
          key={`${slot}|${subjectOf(sentence, i)}|${plainText(sentence, doc)}`}
          layout="position"
          className={className}
          initial={{ opacity: 0, filter: "blur(8px)" }}
          animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
          exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.25, ease: ease.out } }}
          transition={{ duration: 0.6, ease: ease.out, delay: settled ? 0.12 : 0.25 + (from + i) * STEP, layout: move }}
        >
          {sentence.map((run, j) =>
            typeof run === "string" ? (
              <Fragment key={j}>{run}</Fragment>
            ) : "task" in run ? (
              <TaskMention key={j} id={run.task} plain={plainMentions} />
            ) : (
              <span key={j} className="font-medium">
                {doc.people.find((p) => p.id === run.person)?.name}
              </span>
            ),
          )}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** A task named in the text. Clicking it selects the task, so Point & Ask works from the prose. */
function TaskMention({ id, plain }: { id: string; plain: boolean }) {
  const task = useForm((s) => s.doc.tasks[id]);
  const selected = useForm((s) => s.selectedId === id);
  const select = useForm((s) => s.select);
  if (!task) return null;
  const a11y = {
    "aria-pressed": selected,
    "aria-label": selected ? `${task.title}, selected. Deselect` : `${task.title}. Select to ask FORM about it`,
  };
  const pick = () => select(selected ? null : id);
  if (plain) {
    return (
      <button
        type="button"
        data-interactive
        onClick={pick}
        {...a11y}
        className={`focus-ring cursor-pointer rounded-[0.2em] underline decoration-1 underline-offset-[0.14em] transition-colors ${
          selected ? "text-text decoration-ink" : "decoration-black/15 hover:decoration-black/50"
        }`}
      >
        {task.title}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-interactive
      onClick={pick}
      {...a11y}
      className={`focus-ring inline-flex cursor-pointer items-center rounded-full px-2.5 py-px align-baseline transition-colors ${
        selected ? "bg-ink text-on-ink" : "bg-black/[0.06] text-text hover:bg-black/[0.1]"
      }`}
    >
      {task.title}
    </button>
  );
}

function AudienceSwitch({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  return (
    <LayoutGroup id="brief-audience">
      <div role="tablist" aria-label="Audience" className="flex h-[34px] items-center rounded-full bg-black/[0.05] p-[3px]">
        {(["client", "team"] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={value === a}
            onClick={() => value !== a && onChange(a)}
            className={`focus-ring t-body-s relative h-full cursor-pointer rounded-full px-3.5 transition-colors duration-300 ${value === a ? "text-on-ink" : "text-text-2 hover:text-text"}`}
          >
            {value === a && <motion.span layoutId="brief-audience-active" className="absolute inset-0 rounded-full bg-ink" transition={move} />}
            <ShuffleText text={a === "client" ? "Client" : "Team"} className="relative" />
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

/**
 * Rich text where the clipboard takes it (Mail, Gmail, Notion and Slack paste it as
 * formatting), plain text otherwise, and the selection-based copy where the async
 * clipboard is blocked (embedded frames, older Safari).
 */
async function copyBrief(text: string, html: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) }),
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
