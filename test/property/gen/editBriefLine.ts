// Property generator for editBriefLine: a sentence key for either audience (fixed sentences, and
// ones naming a task, which may be missing, or a person), or the key of an existing edit; the text
// is a new wording, "" (hidden), FORM's own wording (restores, or a no-op without an edit), the
// edit's current wording (a no-op), or the raw step text (sometimes untrimmed or multi-line).
import { type OpGen, activeProject, pick, pickPerson, pickTask } from "./_pick";

const SENTENCES = ["head:status", "head:focus", "done:all", "next:up", "next:then", "next:end", "questions:start"];
const BASES = ["UI Design is 30% in, with Marta.", "Nothing is late.", "On the sample schedule, the last task ends 26 Oct."];
const TEXTS = ["Screens are well under way.", "All good this week.", "We are on track."];

const gen: OpGen = (s, state, mint) => {
  const edits = activeProject(state)?.brief.edits ?? {};
  const keys = Object.keys(edits).sort();
  if (keys.length > 0 && s.picks[0] % 3 === 0) {
    // An existing edit: the same wording (a no-op), FORM's wording (restored), or a new one
    const key = pick(keys, s.picks[1]);
    const edit = edits[key];
    const how = s.picks[2] % 3;
    return { op: "editBriefLine", key, text: how === 0 ? edit.text : how === 1 ? edit.basis.trim() : pick(TEXTS, s.picks[3]), basis: edit.basis };
  }
  const audience = s.flags[0] ? "team" : "client";
  const variant = s.picks[1] % 4;
  const sentence =
    variant === 0
      ? pick(SENTENCES, s.picks[2])
      : variant === 1
        ? `moving:${pickTask(s, state, mint, 2)}`
        : variant === 2
          ? `risks:${pickTask(s, state, mint, 2)}`
          : `risks:load:${pickPerson(s, state, mint, 2)}`;
  const basis = pick(BASES, s.picks[3]);
  const how = s.picks[4] % 6;
  const text = how === 0 ? basis : how === 1 ? "" : how === 2 && s.flags[1] ? s.text : pick(TEXTS, s.picks[4]);
  return { op: "editBriefLine", key: `${audience}:${sentence}`, text, basis };
};

export default gen;
