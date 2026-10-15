import { z } from "zod";
import { BRIEF_BASIS, BRIEF_TEXT_MAX } from "@/lib/domain/limits";
import { BriefEditKey } from "@/lib/domain/schema/project";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { baseOf, part, setIfChanged } from "@/lib/ops/registry/_helpers";
import { fitsDoc, namesMissing, recordBytes } from "@/lib/ops/registry/_views";

/**
 * The user's own wording for one composed sentence of the brief (plan §4.4 row 53). The key is
 * "<audience>:<sentence id>"; `basis` is FORM's wording it replaces, so the brief can tell when
 * FORM's version moves on. Text "" hides the sentence. Writing back exactly FORM's wording is no
 * edit at all (v0): the edit is dropped, or the op is a no-op when there was none.
 *
 * A key that names a task or a step the project no longer has is refused: removeTask and
 * removeStep delete the edits keyed to what they remove, and nothing may bring a dangling one back.
 */

/** One trimmed line of the user's words; "" hides the sentence */
const EditText = z
  .string()
  .max(BRIEF_TEXT_MAX)
  .refine((s) => s === s.trim() && !/[\r\n]/.test(s), "Use one trimmed line");

export default defineOp({
  name: "editBriefLine",
  scope: "project",
  schema: z
    .object({ op: z.literal("editBriefLine"), key: BriefEditKey, text: EditText, basis: z.string().max(BRIEF_BASIS) })
    .strict(),

  reduce(d, op) {
    if (namesMissing(op.key, d)) return reject("not_found", "That sentence's task isn't in this project anymore.");
    const edits = d.brief.edits;
    const committed = baseOf(d).brief.edits;
    const existing = Object.hasOwn(committed, op.key) ? committed[op.key] : undefined;
    // Writing back FORM's own wording restores it
    if (op.text === op.basis.trim()) {
      if (existing) delete edits[op.key];
      return;
    }
    const edit = { text: op.text, basis: op.basis };
    const tooLarge = fitsDoc(d, recordBytes(op.key, edit), existing ? recordBytes(op.key, existing) : 0);
    if (tooLarge) return tooLarge;
    setIfChanged(edits, op.key, edit);
  },

  caption({ op, after }) {
    if (!Object.hasOwn(after.brief.edits, op.key)) return part("FORM's wording restored");
    return part(op.text === "" ? "Brief line hidden" : "Brief line edited");
  },
  noopCaption({ op }) {
    if (op.text === op.basis.trim()) return "That line already reads as FORM wrote it";
    return op.text === "" ? "That line is already hidden" : "That line already reads like that";
  },

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["editBriefLine"],
  parser: { exempt: "A direct edit in the brief: the user types over the sentence itself." },
  palette: { exempt: "A direct edit in the brief: the user types over the sentence itself." },
  transport: { tool: "brief", action: "editLine" },
  sample: (fx) => ({
    op: "editBriefLine",
    key: `client:moving:${fx.task("UI Design")}`,
    text: "UI Design is well under way.",
    basis: "UI Design is 30% in, with Marta.",
  }),
});
