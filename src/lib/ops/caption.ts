import { VIEW_LABEL } from "@/lib/domain/labels";
import { CAPTION_TEXT } from "@/lib/domain/limits";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import { type LocalIntent, localCaption } from "@/lib/ops/local-intents";
import { type NoticeKey, noticePart } from "@/lib/ops/notices";
import { type QueryNote, renderNote } from "@/lib/ops/queries";
import type { OpResult } from "@/lib/ops/reduce";
import { type AnyOpDef, SYSTEM_OPS } from "@/lib/ops/registry";
import { type AnyDoc, type CaptionEnv, type CaptionPart, fitText, type Rejection } from "@/lib/ops/registry/_contract";
import { captionKey } from "@/lib/ops/registry/_helpers";

/**
 * The caption composer (plan §1.3, §5.9). A caption is built only from the ops that actually
 * applied (through their registry captions), the local intents, typed query notes and fixed
 * notices. The parser never writes a change caption.
 */

export type CaptionTone = "done" | "proposal" | "info" | "clarify" | "unsupported";

export interface Caption {
  /** At most 280 characters, cut at a part boundary */
  text: string;
  tone: CaptionTone;
  /** True exactly when the command created a history entry */
  undoable: boolean;
}

/** An op refused before it reached a document: no project to apply it to, or over the command limit */
export interface UnroutedResult {
  kind: "rejected";
  doc: null;
  op: unknown;
  rejection: Rejection;
}

/** One op of a command, with the document it saw */
export interface OpOutcome {
  def: AnyOpDef | null;
  /** The document before this op (null when it reached none) */
  before: AnyDoc | null;
  result: OpResult<AnyDoc> | UnroutedResult;
}

export interface ComposeInput {
  outcomes: readonly OpOutcome[];
  local: readonly LocalIntent[];
  /** Views the command created on the same project, in creation order */
  addedViews: readonly ViewKind[];
  notes: readonly QueryNote[];
  notices: readonly NoticeKey[];
  reply?: { tone: "clarify"; text: string };
  env: CaptionEnv;
  historyEntry: boolean;
  /** Direct edits show no caption (v0 parity), unless something was refused or a proposal resolved */
  quiet?: boolean;
}

const RESOLVES_PROPOSAL: ReadonlySet<string> = new Set(["acceptProposal", "discardProposal"]);

const asList = (p: CaptionPart | CaptionPart[] | null): CaptionPart[] => (p === null ? [] : Array.isArray(p) ? p : [p]);

/** A later part with the same key replaces the earlier one in place */
export function mergeKeys(parts: readonly CaptionPart[]): CaptionPart[] {
  const out: CaptionPart[] = [];
  const at = new Map<string, number>();
  for (const p of parts) {
    const i = p.key === undefined ? undefined : at.get(p.key);
    if (i !== undefined) out[i] = p;
    else {
      if (p.key !== undefined) at.set(p.key, out.length);
      out.push(p);
    }
  }
  return out;
}

/**
 * Ported from v0 `announceView`: for each view a command added and shows, the show part's label
 * becomes the announcement ("Team · Marta over capacity" → "Team view added · Marta over
 * capacity") and addView's own part is dropped. An added view that isn't shown keeps addView's
 * part, or gets "{View} view added".
 */
export function announceView(parts: readonly CaptionPart[], added: readonly ViewKind[]): CaptionPart[] {
  let out = [...parts];
  for (const view of added) {
    const label = VIEW_LABEL[view];
    const announced = `${label} view added`;
    const show = out.findIndex((p) => p.key === captionKey.show(view));
    const own = out.findIndex((p) => p.key === captionKey.viewAdded(view));
    if (show >= 0) {
      const text = out[show].text;
      const lead = [label, ...(view === "brief" ? ["Status brief"] : [])].find((l) => text === l || text.startsWith(`${l} · `));
      out[show] = { ...out[show], text: fitText(lead ? announced + text.slice(lead.length) : `${announced} · ${text}`) };
      if (own >= 0) out = out.filter((_, i) => i !== own);
    } else if (own < 0) {
      out.push({ text: announced, key: captionKey.viewAdded(view) });
    }
  }
  return out;
}

/** Joins parts with " · " and cuts at a part boundary so the text stays within 280 characters */
export function joinParts(texts: readonly string[], max = CAPTION_TEXT): string {
  const kept = [...texts];
  while (kept.length > 1 && kept.join(" · ").length > max) kept.pop();
  return fitText(kept.join(" · "), max);
}

export function composeCaption(i: ComposeInput): Caption | null {
  if (i.reply) return { text: fitText(i.reply.text, CAPTION_TEXT), tone: "clarify", undoable: i.historyEntry };

  // System ops (rebalanceOrder) fold into their commit: they never speak
  const visible = i.outcomes.filter((o) => !(o.def && SYSTEM_OPS.has(o.def.name)));
  const applied = visible.filter((o) => o.result.kind === "applied");
  const noops = visible.filter((o) => o.result.kind === "noop");
  const rejected = visible.filter((o) => o.result.kind === "rejected");
  if (i.quiet && rejected.length === 0 && !applied.some((o) => RESOLVES_PROPOSAL.has(o.def!.name))) return null;

  const parts: CaptionPart[] = [];
  for (const o of applied) {
    const result = o.result as Extract<OpResult<AnyDoc>, { kind: "applied" }>;
    parts.push(...asList(o.def!.caption({ op: result.op, before: o.before!, after: result.doc, env: i.env })));
  }
  if (applied.length === 0) {
    for (const o of noops) {
      const text = o.def!.noopCaption({ op: o.result.op as { op: string }, before: o.before!, env: i.env });
      if (text) parts.push({ text: fitText(text) });
    }
  }
  const localParts = i.local.map((l) => localCaption(l, i.env)).filter((p): p is CaptionPart => p !== null);
  const noteParts = i.notes.flatMap((n) => renderNote(n, i.env));
  parts.push(...localParts, ...noteParts, ...i.notices.map(noticePart));

  const texts = announceView(mergeKeys(parts), i.addedViews).map((p) => fitText(p.text));
  if (rejected.length > 0) {
    const message = rejected[0].result.kind === "rejected" ? rejected[0].result.rejection.message : "";
    if (texts.length === 0) texts.push(`Couldn't apply that: ${message}`);
    else texts.push(rejected.length === 1 ? `Couldn't apply one change: ${message}` : `Couldn't apply ${rejected.length} changes: ${message}`);
  }
  if (texts.length === 0) return null;

  let tone: CaptionTone;
  if (applied.some((o) => o.def!.name.startsWith("propose"))) tone = "proposal";
  else if (applied.length > 0) tone = "done";
  else if (rejected.length > 0 && noops.length === 0 && localParts.length === 0 && noteParts.length === 0) tone = "unsupported";
  else if (localParts.length > 0 && noops.length === 0 && noteParts.length === 0) tone = "done";
  else tone = "info";

  return { text: joinParts(texts), tone, undoable: i.historyEntry };
}
