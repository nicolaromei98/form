// Property generator for archivePerson: a person of the workspace (archived ones included, a no-op)
// or a missing one.
import { type OpGen, pickPerson } from "./_pick";

const gen: OpGen = (s, state, mint) => ({ op: "archivePerson", personId: pickPerson(s, state, mint, 0) });

export default gen;
