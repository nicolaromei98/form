"use client";

import { AnimatePresence, motion } from "motion/react";
import { useForm } from "@/lib/store";
import type { Capsule, Circle } from "./geometry";
import { AgentMark } from "./AgentMark";

interface Props {
  visible: boolean;
  frame: { lead: Circle; body: Capsule };
}

/** State F — the agent contracted into a floating capsule, always reachable. */
export function CompactPill({ visible, frame }: Props) {
  const selected = useForm((s) => (s.selectedId ? s.doc.tasks[s.selectedId] : null));
  const proposal = useForm((s) => !!s.doc.proposal);
  const open = useForm((s) => s.openComposer);
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
                key={selected?.id ?? (proposal ? "proposal" : "idle")}
                initial={{ opacity: 0, filter: "blur(8px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(8px)" }}
                transition={{ duration: 0.3 }}
                className="t-body-s flex min-w-0 items-center gap-1.5 text-on-ink"
              >
                {selected ? (
                  <>
                    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-on-ink" />
                    <span className="truncate">{selected.title}</span>
                  </>
                ) : (
                  <span className="text-on-ink-2 transition-colors group-hover:text-on-ink">Ask FORM</span>
                )}
              </motion.span>
            </AnimatePresence>
            <kbd className="t-micro grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-white/[0.1] px-1.5 text-on-ink-2">/</kbd>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
