import type { Minter } from "@/lib/domain/ids";
import { MOOD_TEXT } from "@/lib/domain/limits";
import { sortedByZ } from "@/lib/domain/order";
import type { MoodLayout } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { clarify, Collector, type FamilyResult, unsupported } from "@/lib/interpret/fast/context";
import { capitalise, coloursIn, type Command } from "@/lib/interpret/fast/match";
import { makeOp } from "@/lib/ops/build";

/**
 * The moodboard (plan §8.4 step 10), ported from v0: notes and colours, arranging, clearing and
 * hiding. Arranging and clearing name every reference on the board in z order (plan §13 #11), so
 * a replay touches only what the user saw. Asking for the board brings it back when it is hidden.
 */

const REFS = /\b(references?|inspiration|images?|pictures?|photos?|swatch(es)?|palette)\b/;
const NOTE = /\b(?:add|write|put|pin|leave) (?:a |an |another )?(?:sticky )?note\b(?:\s+(?:saying|that says|with|about))?\s*[:,-]?\s*"?([^"]*)"?$/i;

export function moodboard(cmd: Command, project: ProjectDoc, mint: Minter): FamilyResult | null {
  const { clean, s } = cmd;
  const named = /\bmoodboards?\b/.test(s);
  const has = project.blocks.includes("moodboard");
  const items = sortedByZ(project.moodboard.items);
  const n = items.length;
  const refs = REFS.test(s);
  const colourWord = /\b(colou?rs?|swatch(es)?|palette|hex)\b/.test(s) || /#[0-9a-f]{3,6}\b/.test(s);
  const note = clean.match(NOTE);
  if (!named && !note && !(colourWord && /\b(add|put|include|pin|use)\b/.test(s)) && !(has && refs)) return null;
  const c = new Collector(project);
  const showBoard = () => {
    if (!has) c.op(makeOp({ op: "addBlock", block: "moodboard" }));
  };

  if (named && /\b(remove|hide|close|drop|get rid of)\b/.test(s) && !/\b(note|colou?r|image|reference)s?\b/.test(s)) {
    // Already hidden: the honest no-op says so
    return c.op(makeOp({ op: "removeBlock", block: "moodboard" })).result("keyword");
  }
  if (named && /\b(clear|empty|wipe|delete everything)\b/.test(s)) {
    showBoard();
    // An empty board: the honest no-op says "The moodboard is already empty"
    return c.op(makeOp({ op: "clearMood", itemIds: items.map((it) => it.id) })).result("keyword");
  }
  if (/\b(tidy|arrange|organi[sz]e|lay ?out|clean up|align|sort out|rearrange|grid|masonry|collage|scatter)\b/.test(s) && (named || refs)) {
    if (n < 2) return clarify("Add a few references first — drop images onto the moodboard, or add notes and colours.");
    const layout: MoodLayout = /\b(collage|scatter\w*|loose|messy|table|overlap\w*)\b/.test(s)
      ? "collage"
      : /\b(grid|contact sheet|align\w*|uniform|even\w*|rows?)\b/.test(s)
        ? "grid"
        : "masonry";
    showBoard();
    return c.op(makeOp({ op: "arrangeMood", layout, itemIds: items.map((it) => it.id) })).result("keyword");
  }
  if (note) {
    const text = note[1].trim();
    // Adding references brings a hidden board back on its own
    const body = text ? capitalise(text).slice(0, MOOD_TEXT) : "";
    return c.op(makeOp({ op: "addMoodItems", items: [{ itemId: mint("moodItem"), kind: "note", text: body }] })).result("keyword");
  }
  if (colourWord) {
    const colours = coloursIn(s);
    if (!colours.length) return clarify("Which colours? A hex code or a name — e.g. 'add #E4572E and off-white to the moodboard'.");
    return c
      .op(makeOp({ op: "addMoodItems", items: colours.map((col) => ({ itemId: mint("moodItem"), kind: "color" as const, hex: col.hex, text: col.name })) }))
      .result("keyword");
  }
  if (refs && /\b(add|upload|import|drop|insert|bring in)\b/.test(s)) {
    // Text can't carry image files: say how they get in, and open the board for them
    showBoard();
    return c.result("keyword", { tone: "clarify", text: "Drop images onto the moodboard, paste them, or use Add images" });
  }
  if (named) {
    if (!has) {
      showBoard();
      return c.result("keyword");
    }
    return unsupported("On the moodboard I can add notes and colours, arrange it (masonry, grid, collage), clear or hide it. Images: drop, paste or browse.");
  }
  return null;
}
