import { z } from "zod";
import { normaliseHex } from "@/lib/domain/colours";
import { MOOD_ADD_MAX, MOOD_MAX, MOOD_TEXT } from "@/lib/domain/limits";
import { frontZs, type MoodRect, placeNew } from "@/lib/domain/mood-geometry";
import { sortedByZ } from "@/lib/domain/order";
import { AssetId, MoodItemId } from "@/lib/domain/schema/ids";
import type { MoodItem, ProjectDoc } from "@/lib/domain/schema/project";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { baseOf, ensureFreshId, part } from "@/lib/ops/registry/_helpers";
import { HexInput, itemCount, showBoard } from "@/lib/ops/registry/_mood";

/**
 * Adds references to the moodboard (plan §4.4 row 61; v0 addMoodItems). The producer mints the
 * item ids. Each item lands where v0 put it (`placeNew`: its own size clamped, at its own place
 * when it was dropped somewhere, else in the next free spot), unrotated, stacked above every
 * item already there in payload order. The board fills only up to 200 references and the caption
 * says so; a full board refuses with `limit`. Adding references brings a hidden board back, as in
 * v0.
 */

/** A size, and a place when the item was dropped somewhere; clamped to the stored bounds on write */
const at = { x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional() };
const text = z.string().max(MOOD_TEXT);

const Item = z.discriminatedUnion("kind", [
  z.object({ itemId: MoodItemId, kind: z.literal("image"), assetId: AssetId, text: text.nullable().optional(), ...at }).strict(),
  /** `text` is the colour's name ("Terracotta") */
  z.object({ itemId: MoodItemId, kind: z.literal("color"), hex: HexInput, text: text.nullable().optional(), ...at }).strict(),
  /** "" is an empty note, written on the board afterwards */
  z.object({ itemId: MoodItemId, kind: z.literal("note"), text, ...at }).strict(),
]);
type Item = z.infer<typeof Item>;

/** The items an applied op actually added: the first ones, up to the board's room */
const addedItems = (op: { items: readonly Item[] }, before: ProjectDoc, after: ProjectDoc) =>
  op.items.slice(0, itemCount(after) - itemCount(before));

const KIND_WORD = { image: ["image", "images"], color: ["colour", "colours"], note: ["note", "notes"] } as const;

function addedCaption(items: readonly Item[]): string {
  const n = items.length;
  const first = items[0];
  if (items.some((it) => it.kind !== first.kind)) return `${n} references added to the moodboard`;
  // v0's note wording: "Add a note: …" pins it; an empty note waits to be written
  if (first.kind === "note" && n === 1) return first.text.trim() ? "Note pinned to the moodboard" : "Empty note added · double-click it to write";
  return `${n} ${KIND_WORD[first.kind][n === 1 ? 0 : 1]} added to the moodboard`;
}

export default defineOp({
  name: "addMoodItems",
  scope: "project",
  schema: z
    .object({
      op: z.literal("addMoodItems"),
      items: z
        .array(Item)
        .min(1)
        .max(MOOD_ADD_MAX)
        .refine((items) => new Set(items.map((it) => it.itemId)).size === items.length, "Give each reference its own id"),
    })
    .strict(),

  reduce(d, op) {
    const existing = sortedByZ(baseOf(d).moodboard.items);
    const room = MOOD_MAX - existing.length;
    if (room <= 0) return reject("limit", `The moodboard holds at most ${MOOD_MAX} references.`);
    for (const item of op.items) {
      const taken = ensureFreshId(d, item.itemId);
      if (taken) return taken;
    }

    const adding = op.items.slice(0, room);
    const zs = frontZs(existing, adding.length);
    // Each new item lands among the ones already there and the ones added before it
    const placed: MoodRect[] = [...existing];
    adding.forEach((input, i) => {
      const box = placeNew(input.kind, input, placed);
      placed.push(box);
      const item: MoodItem = {
        id: input.itemId,
        kind: input.kind,
        ...box,
        z: zs[i],
        assetId: input.kind === "image" ? input.assetId : null,
        hex: input.kind === "color" ? normaliseHex(input.hex) : null,
        text: input.text ?? null,
      };
      d.moodboard.items[input.itemId] = item;
    });
    showBoard(d);
  },

  caption({ op, before, after }) {
    const added = addedItems(op, before, after);
    if (added.length < op.items.length) return part(`${added.length} of ${op.items.length} added · the moodboard holds ${MOOD_MAX} references`);
    return part(addedCaption(added));
  },
  // Adding always adds or refuses: fresh ids can't be on the board already, and a full board is `limit`
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: ["addMoodItems"],
  parser: { family: "mood", examples: [{ say: "Add #E4572E and off-white to the moodboard", fixture: "demoMoodShown" }] },
  palette: [
    {
      group: "Moodboard",
      phrase: "Add the colours #0C0C0C, off-white and terracotta",
      rank: 20,
      needs: "project",
      fixture: "demo",
      surfaces: ["demo", "app"],
    },
    { group: "Moodboard", phrase: "Add a note: warm, tactile, editorial", rank: 30, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "moodboard", action: "add" },
  sample: (_fx, mint) => ({
    op: "addMoodItems",
    items: [
      { itemId: mint("moodItem"), kind: "color", hex: "#0C0C0C" },
      { itemId: mint("moodItem"), kind: "color", hex: "#f2efe8", text: "Off white" },
      { itemId: mint("moodItem"), kind: "color", hex: "#c65d3b", text: "Terracotta" },
    ],
  }),
});
