import { z } from "zod";
import type { CaptionEnv, CaptionPart } from "@/lib/ops/registry/_contract";
import { formatDays, part } from "@/lib/ops/registry/_helpers";

/**
 * Typed query notes (plan §1.3, §5.9): informational answers a command gives without changing
 * anything ("Who's overloaded?"). The parser names the question; the wording is composed here from
 * the after state, never from the command text.
 */
export const QueryNoteSchema = z.discriminatedUnion("kind", [
  /** "Who's overloaded?" */
  z.object({ kind: z.literal("overloaded") }).strict(),
  /** "Balance the workload" when there is nothing to move */
  z.object({ kind: z.literal("nothingToBalance") }).strict(),
  /** "Show the progress" when it already shows */
  z.object({ kind: z.literal("alreadyVisible"), what: z.literal("progress") }).strict(),
]);
export type QueryNote = z.infer<typeof QueryNoteSchema>;

/** The lanes of real people, with their names */
function namedLanes(env: CaptionEnv) {
  return env
    .lanes()
    .filter((l) => l.personId !== null)
    .map((l) => ({ ...l, name: env.personName(l.personId!) }));
}

/** "most room: Sara (4d free)", or null without a lane that has room */
function mostRoom(env: CaptionEnv): string | null {
  const roomy = namedLanes(env)
    .filter((l) => l.free !== null && l.free > 0)
    .sort((a, b) => b.free! - a.free! || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
  return roomy ? `most room: ${roomy.name} (${formatDays(roomy.free!)}d free)` : null;
}

export function renderNote(note: QueryNote, env: CaptionEnv): CaptionPart[] {
  switch (note.kind) {
    case "overloaded": {
      const over = env.overloads();
      const room = mostRoom(env);
      const parts = over.length ? over.map((o) => part(`${o.name} is ${formatDays(o.over)}d over`)) : [part("Nobody is over capacity")];
      return room ? [...parts, part(room)] : parts;
    }
    case "nothingToBalance": {
      const worst = env.overloads()[0];
      return [
        part(worst ? `${worst.name} is ${formatDays(worst.over)}d over, but no handover fits anyone's capacity` : "Nobody is over capacity · nothing to move"),
      ];
    }
    case "alreadyVisible":
      return [part("Progress is already visible")];
  }
}
