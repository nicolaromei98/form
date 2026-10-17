// Property generator for addView: any view kind, so a view the project lacks is appended and one
// it has is a no-op (generated60 starts with all six; demo with the tracker alone).
import { ViewKind } from "@/lib/domain/schema/primitives";
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s) => ({ op: "addView", view: pick(ViewKind.options, s.picks[0]) });

export default gen;
