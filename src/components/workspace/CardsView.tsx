"use client";

import { AnimatePresence, motion } from "motion/react";
import { move } from "@/lib/motion";
import { useViewConfig, useVisibleTaskIds } from "@/lib/store/hooks";
import { useWidth } from "@/lib/useWidth";
import { TaskCard } from "./TaskCard";
import { EmptyFilter } from "./EmptyFilter";

/** Representation: tracker — glass cards (comfortable) or capsule rows (compact). */
export function CardsView() {
  const ids = useVisibleTaskIds();
  const view = useViewConfig();
  const [ref, width] = useWidth<HTMLDivElement>();
  const density = view?.density ?? "comfortable";
  const layout = view?.layout ?? "grid";
  const columns = view?.columns ?? null;

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
          {ids.map((id, i) => (
            <TaskCard key={id} id={id} spawnIndex={i < 6 ? i : null} variant={variant} cols={cols} />
          ))}
        </AnimatePresence>
      </motion.div>
      {!ids.length && <EmptyFilter />}
    </div>
  );
}
