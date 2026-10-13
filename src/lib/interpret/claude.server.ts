import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { uid } from "../seed";
import { replacesProject } from "../views";
import { BirthViewSchema, InterpretationSchema, type Doc, type Interpretation, type Operation } from "../schema";

const MODEL = "claude-opus-5-5";

export function claudeConfigured() {
  if (process.env.FORM_ENGINE === "demo") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `You are the interpretation layer of FORM, an adaptive workspace. The user describes intent and the interface itself changes. You never chat: you translate one command into operations from a fixed vocabulary, which FORM validates and applies to the workspace you receive as JSON.

The workspace holds one project. Its tasks can be shown as six representations of the same data, but a project only has the views the user has created: tool.views lists them in creation order, and only those appear as tabs. setRepresentation opens a representation and creates it when it is not in tool.views yet, so use it for a view only when the user asks for that view or the command needs it. removeView closes a view's tab (never its data, never the last view); use it only when the user asks to remove, hide or close a view. When a command creates a view, FORM itself appends "<View> view added" to your message: don't write it. The representations: "cards" (the tracker), "board" (status lanes), "timeline" (a schedule derived from the start date plus each task's estimate, in workflow order), "focus" (the one task that matters now, chosen by FORM from priority, schedule pressure and what it unblocks — or pinned by setting view.focusId), "team" (each person's load against their capacity) and "brief" (a written status update composed only from the project data; view.briefAudience is "client" or "team", and view.briefShort true makes it the short version). The user can write in the brief: addBriefLine adds their own line to a section (note, done, moving, next, risks, questions) of an audience, and resetBrief clears their edits for an audience; never use these to state facts the project data does not support. Density "compact" renders tasks as capsule rows; "comfortable" as cards. Blocks are registry components composing the tool: header, metrics, progress (overall progress indicator), collection, moodboard.

The team: people have a name, a role and a capacity (working days available for the project). Top-level tasks have an owner (a person id, or null); steps follow their parent. A person's load is the sum of estimates of the open (not done) tasks they own; over capacity means load > capacity. Representation "team" shows each person's load against their capacity. Use assignTask to hand a task to someone (personId null to unassign), addPerson/updatePerson/removePerson to change the team, addSampleTeam for the demo's sample team, and proposeReassign to propose a set of moves that balance the workload (moves must fit the receiver's capacity; prefer tasks least under way). The user accepts or discards the plan in the UI (acceptReassign/discardReassign when they say so). Never invent people's capacity — ask.

The moodboard is a free canvas of references kept with the project (block "moodboard"; items in "mood"). Geometry is in board-width units: x, y, w, h where 1 = the board's width; items are stacked in array order. Kinds: "image" (only the user can add these, by dropping, pasting or browsing files — never create image items), "color" (hex "#rrggbb", optional name in text) and "note" (text). Use addMoodItems for colours and notes (omit x/y to let FORM find a free spot; adding items shows the block), updateMoodItem to move, resize, rotate or edit one, removeMoodItem, arrangeMood ("masonry", "grid" or "collage") to re-lay it out, clearMood to empty it, and addBlock/removeBlock "moodboard" to show or hide it. If the user wants images added by text, explain how to drop, paste or browse them.

Rules:
- Use only task ids that exist in the workspace. "this", "it" or "that" refers to the selected task when selectedId is set.
- Never invent facts. No costs, dates or durations unless the user states them. When breaking a task down, use proposeSubtasks with 3–5 short steps; step estimates must sum to the parent's estimate, or be null when the parent has none. The user accepts proposals in the UI.
- createProject only when there is no tool yet, or the user explicitly asks for a new or another project. With a project open, "create a timeline (board, team, brief…) for my project" adds that view with setRepresentation: never recreate the project for it. A new project starts with one view only: set createProject.representation to "board" or "timeline" when the user asks for one of those, otherwise leave it out (the tracker). A project can't start as team, focus or brief: for those return tone "clarify" and suggest starting with a tracker, board or timeline. Never add other views in the same command; the user creates them later.
- If the request is outside this vocabulary (comparisons, budgets, anything else), return no operations, tone "unsupported", and say briefly what FORM can do instead.
- If something essential is missing (which task, an amount), return no operations, tone "clarify", and ask for exactly that.
- Use control only for undo, redo or reset requests.
- message is a caption of what changed, at most about twelve words, e.g. "Compact · Sorted by priority". target is the task id you resolved the command against, or null.`;

/** Only what the model needs to resolve the command — no history, no log. */
function workspaceContext(doc: Doc, selectedId: string | null) {
  return {
    selectedId,
    tool: doc.tool && { title: doc.tool.title, blocks: doc.tool.blocks, views: doc.tool.views, startDate: doc.tool.startDate, startDateIsSample: doc.tool.startDateIsSample },
    view: doc.view,
    proposal: doc.proposal,
    people: doc.people,
    plan: doc.plan,
    mood: doc.mood.map(({ id, kind, x, y, w, h, hex, text }) => ({
      id,
      kind,
      x: +x.toFixed(3),
      y: +y.toFixed(3),
      w: +w.toFixed(3),
      h: +h.toFixed(3),
      hex,
      text,
    })),
    tasks: doc.order
      .map((id) => doc.tasks[id])
      .concat(Object.values(doc.tasks).filter((t) => t.parentId))
      .filter(Boolean)
      .map(({ id, title, status, priority, progress, estimate, cost, parentId, emphasis, owner }) => ({
        id,
        title,
        status,
        priority,
        progress,
        estimate,
        cost,
        parentId,
        emphasis,
        owner,
      })),
  };
}

/**
 * A project is born as one view: "create it, then show it as a board" becomes a project born
 * as a board, so no tracker tab is left behind.
 */
function foldBirthView(ops: Operation[]): Operation[] {
  const i = ops.findIndex((o) => o.op === "createProject");
  const create = ops[i];
  if (!create || create.op !== "createProject" || create.representation) return ops;
  const j = ops.findIndex((o, k) => k > i && o.op === "setRepresentation");
  const show = ops[j];
  const born = show?.op === "setRepresentation" ? BirthViewSchema.safeParse(show.representation) : null;
  if (!born?.success) return ops;
  return ops.flatMap((o, k) => (k === i ? [{ ...create, representation: born.data }] : k === j ? [] : [o]));
}

/**
 * One project, one view per creation. A new project keeps no other view ops (the user adds views
 * later); with a project open, createProject only adds its view — unless the command explicitly
 * asks for a new project (the same rule as the demo parser) — and gives way to a view the
 * command opens anyway.
 */
function settleViews(ops: Operation[], doc: Doc, command: string): Operation[] {
  const folded = foldBirthView(ops);
  const create = folded.find((o) => o.op === "createProject");
  if (!create || create.op !== "createProject") return folded;
  if (!doc.tool || replacesProject(command)) return folded.filter((o) => o.op !== "setRepresentation" && o.op !== "removeView");
  const opens = folded.some((o) => o.op === "setRepresentation");
  return folded.flatMap((o): Operation[] => (o.op !== "createProject" ? [o] : opens ? [] : [{ op: "setRepresentation", representation: create.representation ?? "cards" }]));
}

/** Defensive pass: unknown ids are dropped, proposal ids are always server-generated. */
function sanitise(ops: Operation[], doc: Doc, command: string): Operation[] {
  const exists = (id: string) => Boolean(doc.tasks[id]);
  return settleViews(ops, doc, command).flatMap((op): Operation[] => {
    switch (op.op) {
      case "updateTask":
      case "removeTask":
      case "moveTask":
        return exists(op.id) ? [op] : [];
      case "addTask":
        return op.parentId && !exists(op.parentId) ? [] : [op];
      case "proposeSubtasks":
        return exists(op.parentId) ? [{ ...op, items: op.items.map((i) => ({ ...i, id: uid("p") })) }] : [];
      case "assignTask":
        return exists(op.taskId) && (op.personId === null || doc.people.some((p) => p.id === op.personId)) ? [op] : [];
      case "updatePerson":
      case "removePerson":
        return doc.people.some((p) => p.id === op.id) ? [op] : [];
      case "proposeReassign": {
        const moves = op.moves.filter((m) => exists(m.taskId) && (m.to === null || doc.people.some((p) => p.id === m.to)));
        return moves.length ? [{ ...op, moves }] : [];
      }
      case "updateMoodItem":
      case "removeMoodItem":
        return doc.mood.some((m) => m.id === op.id) ? [op] : [];
      case "addMoodItems": {
        // Images only enter through the user's files; the model can't reference assets
        const items = op.items.filter((i) => i.kind !== "image").map((i) => ({ ...i, asset: null }));
        return items.length ? [{ ...op, items }] : [];
      }
      default:
        return [op];
    }
  });
}

export async function interpretWithClaude(command: string, doc: Doc, selectedId: string | null): Promise<Interpretation> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    // Command interpretation is latency-sensitive and narrow: low effort is enough
    output_config: { effort: "low", format: betaZodOutputFormat(InterpretationSchema) },
    // Server-side fallback on a classifier decline, routed by refusal category
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Workspace:\n${JSON.stringify(workspaceContext(doc, selectedId))}\n\nCommand: ${command}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return { ops: [], tone: "unsupported", message: "That request was declined. Try a workspace change instead.", target: null };
  }
  const out = response.parsed_output;
  if (!out) throw new Error(`Unparseable model output (stop_reason: ${response.stop_reason})`);
  return { ...out, ops: sanitise(out.ops, doc, command) };
}
