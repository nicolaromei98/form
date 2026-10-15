// Property generator for addBlock: any block kind, so a hidden block lands in its canonical place
// and a shown one (header and collection always) is a no-op.
import { BLOCK_ORDER } from "@/lib/domain/schema/primitives";
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s) => ({ op: "addBlock", block: pick(BLOCK_ORDER, s.picks[0]) });

export default gen;
