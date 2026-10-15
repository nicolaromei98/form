"use client";

import { useActions, useTaskIds, useViewConfig } from "@/lib/store/hooks";
import { ShuffleText } from "../text/ShuffleText";

export function EmptyFilter() {
  const hideDone = useViewConfig()?.hideDone ?? false;
  const { commit, addTaskAtEnd } = useActions();
  const count = useTaskIds().length;
  return (
    <div className="flex flex-col items-center gap-3 rounded-[28px] border border-dashed border-line-2 px-6 py-12 text-center">
      <span className="t-body text-text-2">{count === 0 ? "No tasks yet." : "Everything here is filtered out."}</span>
      {hideDone && count > 0 ? (
        <button
          type="button"
          onClick={() => commit([{ op: "setView", patch: { hideDone: false } }], { label: "show done" })}
          className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full bg-ink px-4 text-on-ink"
        >
          <ShuffleText text="Show completed tasks" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => addTaskAtEnd("New task")}
          className="focus-ring t-body-s h-[34px] cursor-pointer rounded-full bg-ink px-4 text-on-ink"
        >
          <ShuffleText text="Add a task" />
        </button>
      )}
    </div>
  );
}
