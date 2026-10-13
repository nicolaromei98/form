"use client";

import { AnimatePresence, LayoutGroup } from "motion/react";
import { useLayoutEffect } from "react";
import { useForm } from "@/lib/store";
import { BLOCKS } from "./registry";

export function Workspace() {
  const tool = useForm((s) => s.doc.tool);
  const rep = useForm((s) => s.doc.view.representation);
  const fx = useForm((s) => s.fx);
  const phase = useForm((s) => s.phase);
  const setSpawn = useForm((s) => s.setSpawn);

  // Creation: measure where each task surface will land so agent volumes can fly there
  useLayoutEffect(() => {
    if (fx.kind !== "create" || phase !== "creating") return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-spawn]"));
    const rects = els
      .sort((a, b) => Number(a.dataset.spawn) - Number(b.dataset.spawn))
      .slice(0, 6)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
    setSpawn(rects);
  }, [fx.seq, fx.kind, phase, setSpawn]);

  if (!tool) return null;

  return (
    <LayoutGroup>
      <div className="mx-auto w-full max-w-[1240px] px-4 pt-[104px] pb-[200px] md:px-10 md:pt-[120px]">
        <AnimatePresence>
          {/* Focus is a stage: only the header line and the stage remain. The brief already
              states progress, so the metrics and progress blocks step aside for it */}
          {tool.blocks
            .filter((b) => (rep === "focus" ? b === "header" || b === "collection" : rep === "brief" ? b !== "metrics" && b !== "progress" : true))
            .map((b) => {
              const Block = BLOCKS[b];
              return <Block key={b} />;
            })}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
