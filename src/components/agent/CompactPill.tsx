"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActions, useProposal, useSelectedTask } from "@/lib/store/hooks";
import type { Capsule, Circle } from "./geometry";
import { AgentMark } from "./AgentMark";
import { ShuffleText } from "../text/ShuffleText";

interface Props {
  visible: boolean;
  frame: { lead: Circle; body: Capsule };
  /** The command a hovered suggestion node will send, shown in place of "Ask FORM" */
  hint?: string | null;
}

/** State F — the agent contracted into a floating capsule, always reachable. */
export function CompactPill({ visible, frame, hint = null }: Props) {
  const selected = useSelectedTask();
  // v0's `doc.proposal`: the steps proposed for a task (the reassign plan never re-keyed the label)
  const proposal = useProposal()?.kind === "subtasks";
  const { openComposer: open } = useActions();
  const { lead, body } = frame;
  const left = lead.cx - lead.r;
  const width = body.x + body.w - left;

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="compact"
          type="button"
          onClick={open}
          aria-label={selected ? `Ask FORM about ${selected.title}` : "Ask FORM"}
          className="focus-ring group fixed z-50 flex cursor-pointer items-center rounded-full"
          style={{ left, top: lead.cy - lead.r, width, height: lead.r * 2 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.55, duration: 0.35 } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
        >
          <span className="grid shrink-0 place-items-center" style={{ width: lead.r * 2, height: lead.r * 2 }}>
            <AgentMark size={24} className="transition-transform duration-500 group-hover:scale-110" />
          </span>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-[14px] pl-[10px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={hint ? `hint-${hint}` : (selected?.id ?? (proposal ? "proposal" : "idle"))}
                initial={{ opacity: 0, filter: "blur(8px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(8px)" }}
                transition={{ duration: 0.3 }}
                className="t-body-s flex min-w-0 items-center gap-1.5 text-on-ink"
              >
                {hint ? (
                  <span className="truncate">{hint}</span>
                ) : selected ? (
                  <>
                    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-on-ink" />
                    <span className="truncate">{selected.title}</span>
                  </>
                ) : (
                  <ShuffleText text="Ask FORM" className="text-on-ink-2 transition-colors group-hover:text-on-ink" />
                )}
              </motion.span>
            </AnimatePresence>
            {/* Leaves while a hint shows, so the command has the whole label width */}
            <AnimatePresence initial={false}>
              {!hint && (
                <motion.kbd
                  key="kbd"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  className="t-micro grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-white/[0.1] px-1.5 text-on-ink-2"
                >
                  /
                </motion.kbd>
              )}
            </AnimatePresence>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
