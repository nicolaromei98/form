import { DEFAULT_VIEW, uid, websiteTemplate } from "./seed";
import type { BlockType, Doc, Operation, Task } from "./schema";

const BLOCK_ORDER: BlockType[] = ["header", "metrics", "progress", "collection"];

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
      return {
        ...doc,
        tasks,
        order: doc.order.filter((id) => id !== op.id),
        proposal: doc.proposal?.parentId === op.id ? null : doc.proposal,
      };
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
        };
      }
      return { ...doc, tasks, proposal: null };
    }

    case "discardProposal":
      return { ...doc, proposal: null };

    case "addBlock": {
      if (!doc.tool || doc.tool.blocks.includes(op.block)) return doc;
      const blocks = BLOCK_ORDER.filter((b) => b === op.block || doc.tool!.blocks.includes(b));
      return { ...doc, tool: { ...doc.tool, blocks } };
    }

    case "removeBlock": {
      if (!doc.tool || op.block === "header" || op.block === "collection") return doc;
      return { ...doc, tool: { ...doc.tool, blocks: doc.tool.blocks.filter((b) => b !== op.block) } };
    }

    case "setStartDate":
      if (!doc.tool) return doc;
      return { ...doc, tool: { ...doc.tool, startDate: op.date, startDateIsSample: false } };
  }
}

export function applyOperations(doc: Doc, ops: Operation[]): Doc {
  return ops.reduce(applyOperation, doc);
}
