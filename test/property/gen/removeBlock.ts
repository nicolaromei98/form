// Property generator for removeBlock: any block kind, so a shown block is hidden, a hidden one is
// a no-op, and header and collection are refused (protected_block).
import { BLOCK_ORDER } from "@/lib/domain/schema/primitives";
import { type OpGen, pick } from "./_pick";

const gen: OpGen = (s) => ({ op: "removeBlock", block: pick(BLOCK_ORDER, s.picks[0]) });

export default gen;
