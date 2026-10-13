import { DEFAULT_VIEW, SAMPLE_OWNERS, sampleTeam, uid, websiteTemplate } from "./seed";
import { addMoodItems, arrangeMood, patchMoodItem } from "./mood";
import type { BlockType, Doc, Operation, ReassignPlan, Task } from "./schema";

const BLOCK_ORDER: BlockType[] = ["header", "metrics", "progress", "collection", "moodboard"];

/** Keeps only moves that still make sense: open top-level tasks going to someone who exists, and somewhere new */
function validPlan(doc: Doc, plan: ReassignPlan | null): ReassignPlan | null {
  if (!plan) return null;
  const moves = plan.moves.filter((m) => {
    const t = doc.tasks[m.taskId];
    return t && !t.parentId && t.status !== "done" && (m.to === null || doc.people.some((p) => p.id === m.to)) && m.to !== t.owner;
  });
  return moves.length ? { moves } : null;
}

function withBlock(doc: Doc, block: BlockType): Doc {
  if (!doc.tool || doc.tool.blocks.includes(block)) return doc;
  const blocks = BLOCK_ORDER.filter((b) => b === block || doc.tool!.blocks.includes(b));
  return { ...doc, tool: { ...doc.tool, blocks } };
}

/** Pure reducer: applies one validated operation to the document. */
export function applyOperation(doc: Doc, op: Operation): Doc {
  switch (op.op) {
    case "createProject": {
      const t = websiteTemplate(op.title);
      return {
        tool: t.tool,
        tasks: t.tasks,
        order: t.order,
        view: { ...DEFAULT_VIEW, fields: { ...DEFAULT_VIEW.fields } },
        proposal: null,
        mood: [],
        people: t.people,
        plan: null,
        brief: { edits: {}, lines: [] },
      };
    }

    case "renameTool":
      if (!doc.tool) return doc;
      return { ...doc, tool: { ...doc.tool, title: op.title } };

    case "setRepresentation":
      return { ...doc, view: { ...doc.view, representation: op.representation } };

    case "setView": {
      const patch = { ...op.patch };
      if (patch.columns != null && patch.layout == null) patch.layout = patch.columns === 1 ? "list" : "grid";
      if (patch.layout === "grid" && patch.columns === undefined && doc.view.columns === 1) patch.columns = null;
      if (patch.layout === "list" && patch.columns === undefined) patch.columns = null;
      return { ...doc, view: { ...doc.view, ...patch } };
    }

    case "setFields":
      return { ...doc, view: { ...doc.view, fields: { ...doc.view.fields, ...op.patch } } };

    case "updateTask": {
      const prev = doc.tasks[op.id];
      if (!prev) return doc;
      const next: Task = { ...prev, ...op.patch };
      // Keep status and progress coherent when only one of them changes
      if (op.patch.status === "done" && op.patch.progress === undefined) next.progress = 100;
      if (op.patch.status === "todo" && op.patch.progress === undefined && prev.status === "done") next.progress = 0;
      if (op.patch.progress !== undefined && op.patch.status === undefined) {
        if (next.progress >= 100) next.status = "done";
        else if (prev.status === "done") next.status = "active";
        else if (prev.status === "todo" && next.progress > 0) next.status = "active";
      }
      return { ...doc, tasks: { ...doc.tasks, [op.id]: next } };
    }

    case "addTask": {
      if (op.parentId && !doc.tasks[op.parentId]) return doc;
      const id = uid();
      const t: Task = {
        id,
        title: op.title,
        status: "todo",
        priority: op.priority ?? "medium",
        progress: 0,
        estimate: op.estimate,
        cost: null,
        parentId: op.parentId,
        emphasis: false,
        origin: "user",
        owner: null,
      };
      return {
        ...doc,
        tasks: { ...doc.tasks, [id]: t },
        order: op.parentId ? doc.order : [...doc.order, id],
      };
    }

    case "removeTask": {
      if (!doc.tasks[op.id]) return doc;
      const tasks = { ...doc.tasks };
      delete tasks[op.id];
      for (const t of Object.values(tasks)) if (t.parentId === op.id) delete tasks[t.id];
      const next = { ...doc, tasks, order: doc.order.filter((id) => id !== op.id), proposal: doc.proposal?.parentId === op.id ? null : doc.proposal };
      return { ...next, plan: validPlan(next, doc.plan) };
    }

    case "moveTask": {
      const from = doc.order.indexOf(op.id);
      if (from < 0) return doc;
      const order = doc.order.filter((id) => id !== op.id);
      order.splice(Math.min(op.toIndex, order.length), 0, op.id);
      return { ...doc, order };
    }

    case "proposeSubtasks":
      if (!doc.tasks[op.parentId]) return doc;
      return { ...doc, proposal: { parentId: op.parentId, items: op.items } };

    case "acceptProposal": {
      const p = doc.proposal;
      if (!p || !doc.tasks[p.parentId]) return { ...doc, proposal: null };
      const parent = doc.tasks[p.parentId];
      const tasks = { ...doc.tasks };
      for (const item of p.items) {
        // Reuse the proposal id so the proposed row morphs into the real step
        const id = tasks[item.id] ? uid("s") : item.id;
        tasks[id] = {
          id,
          title: item.title,
          status: "todo",
          priority: parent.priority,
          progress: 0,
          estimate: item.estimate,
          cost: null,
          parentId: parent.id,
          emphasis: false,
          origin: "agent",
          owner: null,
        };
      }
      return { ...doc, tasks, proposal: null };
    }

    case "discardProposal":
      return { ...doc, proposal: null };

    case "addBlock":
      return withBlock(doc, op.block);

    case "removeBlock": {
      if (!doc.tool || op.block === "header" || op.block === "collection") return doc;
      return { ...doc, tool: { ...doc.tool, blocks: doc.tool.blocks.filter((b) => b !== op.block) } };
    }

    case "setStartDate":
      if (!doc.tool) return doc;
      return { ...doc, tool: { ...doc.tool, startDate: op.date, startDateIsSample: false } };

    case "addMoodItems": {
      const mood = addMoodItems(doc.mood, op.items);
      // Adding references brings the board back if it was hidden
      return mood.length === doc.mood.length ? doc : withBlock({ ...doc, mood }, "moodboard");
    }

    case "updateMoodItem": {
      const i = doc.mood.findIndex((m) => m.id === op.id);
      if (i < 0) return doc;
      const item = patchMoodItem(doc.mood[i], op.patch);
      const mood = doc.mood.filter((m) => m.id !== op.id);
      if (op.raise) mood.push(item);
      else mood.splice(i, 0, item);
      return { ...doc, mood };
    }

    case "removeMoodItem":
      return doc.mood.some((m) => m.id === op.id) ? { ...doc, mood: doc.mood.filter((m) => m.id !== op.id) } : doc;

    case "arrangeMood":
      return doc.mood.length ? { ...doc, mood: arrangeMood(doc.mood, op.layout) } : doc;

    case "clearMood":
      return doc.mood.length ? { ...doc, mood: [] } : doc;

    case "addPerson": {
      const name = op.name.trim();
      if (!name || doc.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return doc;
      const person = { id: uid("p"), name: name[0].toUpperCase() + name.slice(1), role: op.role?.trim() || null, capacity: op.capacity ?? 10 };
      return { ...doc, people: [...doc.people, person] };
    }

    case "updatePerson": {
      if (!doc.people.some((p) => p.id === op.id)) return doc;
      const people = doc.people.map((p) => (p.id === op.id ? { ...p, ...op.patch, name: op.patch.name?.trim() || p.name } : p));
      return { ...doc, people };
    }

    case "removePerson": {
      if (!doc.people.some((p) => p.id === op.id)) return doc;
      // Their work stays in the project, unassigned
      const tasks = Object.fromEntries(Object.entries(doc.tasks).map(([id, t]) => [id, t.owner === op.id ? { ...t, owner: null } : t]));
      const next = { ...doc, tasks, people: doc.people.filter((p) => p.id !== op.id) };
      return { ...next, plan: validPlan(next, doc.plan) };
    }

    case "assignTask": {
      const t = doc.tasks[op.taskId];
      if (!t || t.parentId || t.owner === op.personId) return doc;
      if (op.personId && !doc.people.some((p) => p.id === op.personId)) return doc;
      const next = { ...doc, tasks: { ...doc.tasks, [t.id]: { ...t, owner: op.personId } } };
      return { ...next, plan: validPlan(next, doc.plan) };
    }

    case "addSampleTeam": {
      const people = [...doc.people, ...sampleTeam().filter((s) => !doc.people.some((p) => p.id === s.id || p.name === s.name))];
      const ids = new Set(people.map((p) => p.id));
      const tasks = Object.fromEntries(
        Object.entries(doc.tasks).map(([id, t]) => [id, !t.owner && SAMPLE_OWNERS[id] && ids.has(SAMPLE_OWNERS[id]) ? { ...t, owner: SAMPLE_OWNERS[id] } : t]),
      );
      return { ...doc, people, tasks };
    }

    case "proposeReassign": {
      const plan = validPlan(doc, { moves: op.moves });
      return plan ? { ...doc, plan } : doc;
    }

    case "acceptReassign": {
      const plan = validPlan(doc, doc.plan);
      if (!plan) return { ...doc, plan: null };
      const tasks = { ...doc.tasks };
      for (const m of plan.moves) tasks[m.taskId] = { ...tasks[m.taskId], owner: m.to };
      return { ...doc, tasks, plan: null };
    }

    case "editBriefLine": {
      const edits = { ...doc.brief.edits };
      const text = op.text.replace(/\s+/g, " ").trim();
      // Writing back exactly what FORM composed is no edit at all
      if (text === op.basis.trim()) delete edits[op.key];
      else edits[op.key] = { text, basis: op.basis };
      return { ...doc, brief: { ...doc.brief, edits } };
    }

    case "resetBriefLine": {
      if (!(op.key in doc.brief.edits)) return doc;
      const edits = { ...doc.brief.edits };
      delete edits[op.key];
      return { ...doc, brief: { ...doc.brief, edits } };
    }

    case "addBriefLine": {
      const text = op.text.replace(/\s+/g, " ").trim();
      if (!text) return doc;
      return { ...doc, brief: { ...doc.brief, lines: [...doc.brief.lines, { id: uid("b"), audience: op.audience, section: op.section, text }] } };
    }

    case "updateBriefLine": {
      const text = op.text.replace(/\s+/g, " ").trim();
      if (!doc.brief.lines.some((l) => l.id === op.id)) return doc;
      const lines = text ? doc.brief.lines.map((l) => (l.id === op.id ? { ...l, text } : l)) : doc.brief.lines.filter((l) => l.id !== op.id);
      return { ...doc, brief: { ...doc.brief, lines } };
    }

    case "removeBriefLine":
      return doc.brief.lines.some((l) => l.id === op.id) ? { ...doc, brief: { ...doc.brief, lines: doc.brief.lines.filter((l) => l.id !== op.id) } } : doc;

    case "resetBrief": {
      const edits = Object.fromEntries(Object.entries(doc.brief.edits).filter(([k]) => !k.startsWith(`${op.audience}:`)));
      const lines = doc.brief.lines.filter((l) => l.audience !== op.audience);
      if (lines.length === doc.brief.lines.length && Object.keys(edits).length === Object.keys(doc.brief.edits).length) return doc;
      return { ...doc, brief: { edits, lines } };
    }

    case "discardReassign":
      return doc.plan ? { ...doc, plan: null } : doc;
  }
}

export function applyOperations(doc: Doc, ops: Operation[]): Doc {
  return ops.reduce(applyOperation, doc);
}
