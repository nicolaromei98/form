"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { useForm } from "@/lib/store";
import { move } from "@/lib/motion";
import { taskNumber, visibleTasks } from "@/lib/selectors";
import { useWidth } from "@/lib/useWidth";
import { TaskCard } from "./TaskCard";
import { EmptyFilter } from "./EmptyFilter";

/** Representation: tracker — glass cards (comfortable) or capsule rows (compact). */
export function CardsView() {
  const doc = useForm((s) => s.doc);
  const tasks = useMemo(() => visibleTasks(doc), [doc]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const { density, layout, columns } = doc.view;

  const variant = density === "compact" ? "row" : "card";
  const minCol = variant === "row" ? 380 : 228;
  const wanted = layout === "list" ? 1 : columns ?? (variant === "row" ? 2 : 4);
  const fit = Math.max(1, Math.floor((width + 12) / (minCol + 12)));
  const cols = Math.min(wanted, fit);

  return (
    <div ref={ref}>
      <motion.div
        layout
        className="grid items-start"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: variant === "row" ? 10 : 14 }}
        transition={move}
      >
        <AnimatePresence mode="popLayout">
          {tasks.map((t, i) => (
            <TaskCard key={t.id} task={t} number={taskNumber(doc, t.id)} spawnIndex={i < 6 ? i : null} variant={variant} cols={cols} />
          ))}
        </AnimatePresence>
      </motion.div>
      {!tasks.length && <EmptyFilter />}
    </div>
  );
}
