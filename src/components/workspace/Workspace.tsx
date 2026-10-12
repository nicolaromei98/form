"use client";

import { AnimatePresence, LayoutGroup } from "motion/react";
import { useLayoutEffect } from "react";
import { useForm } from "@/lib/store";
import { BLOCKS } from "./registry";

export function Workspace() {
  const tool = useForm((s) => s.doc.tool);
  const focus = useForm((s) => s.doc.view.representation === "focus");
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
          {/* In focus, only the header line and the stage remain */}
          {tool.blocks.filter((b) => !focus || b === "header" || b === "collection").map((b) => {
            const Block = BLOCKS[b];
            return <Block key={b} />;
          })}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
