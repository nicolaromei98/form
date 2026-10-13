"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useForm } from "@/lib/store";
import { ease, move } from "@/lib/motion";
import { briefHtml, briefPlainText, composeBrief, lineText, type Audience, type Brief, type BriefLine, type BriefSection } from "@/lib/brief";
import { BRIEF_TEXT_MAX, type BriefSectionKey, type Doc } from "@/lib/schema";
import { DecodeText } from "../text/TextMotion";
import { ShuffleText } from "../text/ShuffleText";

/** Stagger for the first reveal, line by line; after that, only changed lines move */
const STEP = 0.06;

/**
 * Representation: brief. The project as a written status update on a sheet of
 * paper — the only view that is prose rather than space. FORM composes it from
 * the document on every change; the user can rewrite any line, hide it, or add
 * their own. A rewritten line whose facts later change is flagged, with FORM's
 * new wording beside it, so the brief never quietly drifts from the project.
 */
export function BriefView() {
  const doc = useForm((s) => s.doc);
  const commit = useForm((s) => s.commit);
  const audience: Audience = doc.view.briefAudience ?? "client";
  const short = doc.view.briefShort ?? false;
  const brief = useMemo(() => composeBrief(doc, audience, short), [doc, audience, short]);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  // Which section is taking a new line from the user ("note" sits under the headline)
  const [adding, setAdding] = useState<BriefSectionKey | null>(null);
  // Lines condense in one after another on arrival; later rewrites shouldn't wait their turn
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1600);
    return () => clearTimeout(t);
  }, []);

  if (!brief) return null;
  const offsets = sectionOffsets(brief);
  const note = brief.sections.find((s) => s.key === "note");
  const body = brief.sections.filter((s) => s.key !== "note");

  const copy = async () => {
    const ok = await copyBrief(briefPlainText(brief, doc), briefHtml(brief, doc));
    setCopied(ok ? "done" : "failed");
    setTimeout(() => setCopied("idle"), 1800);
  };
  const addLine = (section: BriefSectionKey, text: string) => {
    setAdding(null);
    if (text.trim()) commit([{ op: "addBriefLine", audience, section, text }], "add to brief");
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
        <AnimatePresence mode="popLayout">
          {brief.headline.map((line, i) => (
            <Row key={line.key} line={line} doc={doc} delay={rowDelay(settled, i)} className={`block ${i === 1 ? "text-text-3" : ""}`} plainMentions />
          ))}
        </AnimatePresence>
      </h2>

      <div className="mt-8 h-[3px] overflow-hidden rounded-full bg-black/[0.07]">
        <motion.div className="h-full rounded-full bg-ink" initial={{ width: 0 }} animate={{ width: `${brief.progress}%` }} transition={{ ...move, delay: 0.35 }} />
      </div>

      {/* A personal note sits under the headline: "Hi Anna, here's where we are" */}
      {note || adding === "note" ? (
        <Section section={note ?? { key: "note", label: "Note", lines: [] }} doc={doc} settled={settled} from={2} adding={adding === "note"} onAdd={setAdding} onAdded={addLine} first />
      ) : (
        <button
          type="button"
          onClick={() => setAdding("note")}
          className="focus-ring t-body-s mt-6 flex cursor-pointer items-center gap-2 rounded-full py-1 pr-2 text-text-3 transition-colors hover:text-text"
        >
          <Plus />
          Add a note for the {audience}
        </button>
      )}

      <div className="mt-6 flex flex-col">
        {body.map((sec) => (
          <Section key={sec.key} section={sec} doc={doc} settled={settled} from={offsets[sec.key]} adding={adding === sec.key} onAdd={setAdding} onAdded={addLine} />
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

      <motion.div layout="position" transition={{ layout: move }} className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-5">
        <p className="t-data text-text-3">
          Composed by FORM from the project data. Nothing is invented: what it doesn&rsquo;t know is listed as a question. Click any line to rewrite it.
        </p>
        {brief.changes > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {brief.hidden.length > 0 && (
              <button
                type="button"
                onClick={() => commit(brief.hidden.map((key) => ({ op: "resetBriefLine" as const, key })), "show hidden lines")}
                className="focus-ring t-data cursor-pointer rounded-full px-3 py-1.5 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
              >
                Show {brief.hidden.length} hidden
              </button>
            )}
            <button
              type="button"
              onClick={() => commit([{ op: "resetBrief", audience }], "reset brief")}
              className="focus-ring t-data cursor-pointer rounded-full bg-black/[0.05] px-3 py-1.5 text-text-2 transition-colors hover:bg-black/[0.08] hover:text-text"
            >
              {brief.changes} {brief.changes === 1 ? "edit" : "edits"} · Reset to FORM&rsquo;s version
            </button>
          </div>
        )}
      </motion.div>
    </motion.article>
  );
}

/** Where each section's lines start in the reveal order (the two headline lines come first) */
function sectionOffsets(brief: Brief): Record<string, number> {
  return brief.sections.reduce<{ at: number; map: Record<string, number> }>(
    (acc, s) => ({ at: acc.at + s.lines.length, map: { ...acc.map, [s.key]: acc.at } }),
    { at: 2, map: {} },
  ).map;
}

const rowDelay = (settled: boolean, order: number) => (settled ? 0.12 : 0.25 + order * STEP);

function Section({
  section,
  doc,
  settled,
  from,
  adding,
  onAdd,
  onAdded,
  first = false,
}: {
  section: BriefSection;
  doc: Doc;
  settled: boolean;
  from: number;
  adding: boolean;
  onAdd: (key: BriefSectionKey | null) => void;
  onAdded: (key: BriefSectionKey, text: string) => void;
  first?: boolean;
}) {
  return (
    <motion.section
      layout="position"
      transition={{ layout: move }}
      className={`group/section grid gap-x-8 gap-y-2 pt-5 pb-3 md:grid-cols-[136px_minmax(0,1fr)] ${first ? "mt-6" : "border-t border-line"}`}
    >
      <span className="t-micro pt-[5px] text-text-3">{section.label}</span>
      <div className="relative flex min-w-0 flex-col gap-1.5">
        <AnimatePresence mode="popLayout">
          {section.lines.map((line, i) => (
            <Row key={line.key} line={line} doc={doc} delay={rowDelay(settled, from + i)} className="t-body-l block text-text" />
          ))}
        </AnimatePresence>
        {adding ? (
          <Editor
            initial=""
            placeholder={section.key === "note" ? "Write a note…" : "Write a line…"}
            className="t-body-l block text-text"
            onDone={(text) => onAdded(section.key, text)}
            onCancel={() => onAdd(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => onAdd(section.key)}
            className="focus-ring t-body-s -mt-0.5 flex h-[22px] w-fit cursor-pointer items-center gap-1.5 rounded-full pr-2 text-text-3 transition-[color,opacity] hover:text-text focus-visible:opacity-100 sm:opacity-0 sm:group-hover/section:opacity-100"
          >
            <Plus />
            Add a line
          </button>
        )}
      </div>
    </motion.section>
  );
}

/**
 * One line of the brief. FORM's wording keeps its task mentions (Point & Ask);
 * the user's wording is plain text. Click the text, or the pencil, to rewrite it.
 */
function Row({ line, doc, delay, className, plainMentions = false }: { line: BriefLine; doc: Doc; delay: number; className: string; plainMentions?: boolean }) {
  const commit = useForm((s) => s.commit);
  const [editing, setEditing] = useState(false);
  // FORM's wording when the edit began: if the facts move on mid-edit, the line is flagged rather than silently re-based
  const basis = useRef(line.composed);
  const text = lineText(line, doc);
  const mine = line.kind === "custom" || line.edited != null;

  const begin = () => {
    basis.current = line.composed;
    setEditing(true);
  };
  const save = (next: string) => {
    setEditing(false);
    if (next.replace(/\s+/g, " ").trim() === text.trim()) return;
    if (line.kind === "custom") commit([{ op: "updateBriefLine", id: line.id, text: next }], next.trim() ? "edit brief line" : "remove brief line");
    else commit([{ op: "editBriefLine", key: line.key, text: next, basis: basis.current }], next.trim() ? "edit brief" : "hide brief line");
  };
  const startEditing = (e: MouseEvent<HTMLSpanElement>) => {
    // Mentions keep selecting their task; everything else in the line opens the editor
    if ((e.target as HTMLElement).closest("button")) return;
    // A drag that selected part of the line is someone copying, not editing
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
    begin();
  };

  return (
    <motion.div
      layout="position"
      data-interactive
      className="group/line relative"
      initial={{ opacity: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.25, ease: ease.out } }}
      transition={{ duration: 0.6, ease: ease.out, delay, layout: move }}
    >
      {editing ? (
        <Editor initial={text} className={className} onDone={save} onCancel={() => setEditing(false)} />
      ) : (
        <span className={`${className} cursor-text`} onClick={startEditing}>
          {/* FORM's wording rewrites in place when the facts change; the user's settles in once */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={mine ? "mine" : text}
              className="inline"
              initial={{ opacity: 0, filter: "blur(8px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
              exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.22 } }}
              transition={{ duration: 0.55, ease: ease.out }}
            >
              {mine ? text : <Runs line={line} doc={doc} plainMentions={plainMentions} />}
            </motion.span>
          </AnimatePresence>
          <LineTools line={line} onEdit={begin} />
        </span>
      )}
      {line.stale && !editing && <Stale line={line} doc={doc} />}
    </motion.div>
  );
}

function Runs({ line, doc, plainMentions }: { line: BriefLine; doc: Doc; plainMentions: boolean }) {
  return (
    <>
      {line.runs.map((run, j) =>
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
    </>
  );
}

/** Quiet controls after a line: edit, and undo the user's version or remove their own line */
function LineTools({ line, onEdit }: { line: BriefLine; onEdit: () => void }) {
  const commit = useForm((s) => s.commit);
  const tool =
    "focus-ring ml-1.5 inline-grid h-[22px] w-[22px] translate-y-[-0.12em] cursor-pointer place-items-center rounded-full align-middle text-text-3 transition-[color,opacity,background-color] hover:bg-black/[0.06] hover:text-text focus-visible:opacity-100 sm:opacity-0 sm:group-hover/line:opacity-100";
  return (
    <span className="whitespace-nowrap">
      <button type="button" aria-label="Rewrite this line" title="Rewrite" onClick={onEdit} className={tool}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8.2 1.8l2 2L4 10l-2.6.6L2 8z" />
        </svg>
      </button>
      {line.kind === "composed" && line.edited != null && (
        <button type="button" aria-label="Back to FORM's wording" title="Back to FORM's wording" onClick={() => commit([{ op: "resetBriefLine", key: line.key }], "reset brief line")} className={tool}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2.5 4.5h5a2.5 2.5 0 010 5H5M2.5 4.5L4.5 2.5M2.5 4.5l2 2" />
          </svg>
        </button>
      )}
      {line.kind === "custom" && (
        <button type="button" aria-label="Remove this line" title="Remove" onClick={() => commit([{ op: "removeBriefLine", id: line.id }], "remove brief line")} className={tool}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** The data moved on since the user rewrote this line: show FORM's new wording and let them choose */
function Stale({ line, doc }: { line: BriefLine; doc: Doc }) {
  const commit = useForm((s) => s.commit);
  const now = lineText({ ...line, edited: null }, doc);
  return (
    <motion.div
      className="t-data mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-3"
      initial={{ opacity: 0, filter: "blur(6px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: ease.out }}
    >
      <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-signal" />
      <span>
        FORM&rsquo;s version changed: <span className="text-text-2">&ldquo;{now}&rdquo;</span>
      </span>
      <button
        type="button"
        onClick={() => commit([{ op: "resetBriefLine", key: line.key }], "use FORM's version")}
        className="focus-ring cursor-pointer rounded-full bg-black/[0.05] px-2.5 py-1 text-text-2 transition-colors hover:bg-black/[0.08] hover:text-text"
      >
        Use FORM&rsquo;s
      </button>
      <button
        type="button"
        onClick={() => commit([{ op: "editBriefLine", key: line.key, text: line.edited ?? "", basis: line.composed }], "keep my wording")}
        className="focus-ring cursor-pointer rounded-full px-2.5 py-1 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
      >
        Keep mine
      </button>
    </motion.div>
  );
}

/** Put the caret after the last character */
function caretToEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * In-place plain-text editor. Enter saves (on an emptied line it hides it), Escape cancels,
 * clicking away saves — but clicking away from an emptied line leaves it as it was, and
 * switching window or tab keeps the edit open.
 */
function Editor({ initial, className, placeholder, onDone, onCancel }: { initial: string; className: string; placeholder?: string; onDone: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Read once: the user's typing is never overwritten when the data behind the line changes mid-edit
  const first = useRef(initial);
  const settled = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = first.current;
    el.focus();
    caretToEnd(el);
  }, []);

  const finish = (text: string | null) => {
    if (settled.current) return;
    settled.current = true;
    if (text === null) onCancel();
    else onDone(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    // Enter and Escape belong to the IME while it is composing (Japanese, Chinese, Korean input)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      finish(e.currentTarget.textContent ?? "");
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
  };

  const onInput = (e: FormEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    const t = el.textContent ?? "";
    if (t.length <= BRIEF_TEXT_MAX) return;
    el.textContent = t.slice(0, BRIEF_TEXT_MAX);
    caretToEnd(el);
  };

  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    // The window or tab lost focus: the edit stays open and focus returns with it
    if (!document.hasFocus()) return;
    const t = e.currentTarget.textContent ?? "";
    finish(t.trim() ? t : null);
  };

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label={placeholder ?? "Edit line"}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      data-interactive
      onKeyDown={onKeyDown}
      onInput={onInput}
      onBlur={onBlur}
      className={`${className} -mx-2 rounded-[10px] bg-black/[0.04] px-2 outline-none empty:before:text-text-4 empty:before:content-[attr(data-placeholder)]`}
    />
  );
}

function Plus() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
      <path d="M5 1.5v7M1.5 5h7" />
    </svg>
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
