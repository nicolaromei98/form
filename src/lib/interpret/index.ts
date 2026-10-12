import { interpretDemo, type InterpretContext } from "./demo";
import { InterpretationSchema, type Interpretation } from "../schema";

export type EngineId = "demo" | "claude";

/** Provider abstraction: every engine returns the same validated structure. */
export interface Interpreter {
  id: EngineId;
  label: string;
  interpret(command: string, ctx: InterpretContext): Promise<Interpretation>;
}

export const demoInterpreter: Interpreter = {
  id: "demo",
  label: "Demo parser",
  async interpret(command, ctx) {
    return interpretDemo(command, ctx);
  },
};

/** Server-side model call (API key never reaches the client). */
export const claudeInterpreter: Interpreter = {
  id: "claude",
  label: "Claude",
  async interpret(command, ctx) {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, doc: ctx.doc, selectedId: ctx.selectedId }),
    });
    if (!res.ok) throw new Error(`interpret ${res.status}`);
    return InterpretationSchema.parse(await res.json());
  },
};

export type { InterpretContext };
