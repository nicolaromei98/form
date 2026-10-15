"use client";

import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { MOOD_ADD_MAX, MOOD_TEXT } from "@/lib/domain/limits";
import type { MoodItemId } from "@/lib/domain/schema/ids";
import type { MoodLayout } from "@/lib/domain/schema/primitives";
import type { MoodItem } from "@/lib/domain/schema/project";
import { type BoardPoint, useActions, useMoodItems } from "@/lib/store/hooks";
import { ease, move } from "@/lib/motion";
import { isImageFile, useAssetUrl } from "@/lib/assets";
import { useWidth } from "@/lib/useWidth";
import { BlockShell } from "./blocks";
import { Popover } from "./parts";
import { ColorPicker } from "./ColorPicker";
import { DecodeText } from "../text/TextMotion";
import { ShuffleText } from "../text/ShuffleText";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && Boolean(t.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
const hasFiles = (e: { dataTransfer: DataTransfer | null }) => Boolean(e.dataTransfer?.types.includes("Files"));

/**
 * Moodboard — a free canvas of references kept with the project. Drop, paste
 * or browse images; add notes and colours; drag to arrange, resize from the
 * corner, or let FORM tidy it into a masonry, a grid or a collage.
 */
export function MoodboardBlock() {
  // Bottom to top (z order): later tiles paint over earlier ones, as v0's array order did
  const items = useMoodItems();
  const actions = useActions();
  // Width starts at 0: tiles only mount once the real width is known, so nothing slides in from a guess
  const [boardRef, W] = useWidth<HTMLDivElement>(0);
  const [selected, setSelected] = useState<MoodItemId | null>(null);
  const [editing, setEditing] = useState<MoodItemId | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // FORM's own colour picker, anchored under the Colour button
  const [colourAnchor, setColourAnchor] = useState<HTMLButtonElement | null>(null);
  const [colourAt, setColourAt] = useState<{ x: number; y: number } | null>(null);

  // Board height follows its content (in board-width units), with room to drop below
  const bottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  const height = Math.max(items.length ? (bottom + 0.08) * W : 0, W * 0.4, 240);

  const addFiles = useCallback(
    async (files: File[], at?: BoardPoint) => {
      // The images addImages takes from these files: at most 24 at once
      const count = Math.min(files.filter(isImageFile).length, MOOD_ADD_MAX);
      if (!count) return;
      setBusy((n) => n + count);
      try {
        // Stored under fresh ast_ ids, then added in one command. Dropped files land under the
        // pointer as one row centred on it; pasted or browsed ones find free spots
        await actions.addImages(files, at);
      } finally {
        setBusy((n) => n - count);
      }
    },
    [actions],
  );

  // Paste anywhere, and never let a missed drop navigate the page away to the file
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      if (!boardRef.current?.contains(e.target as Node)) addFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles, boardRef]);

  // A selected reference can leave the board (undo, a typed command). Deleting it then does
  // nothing, as in v0: the op would be refused, and a refusal speaks
  const selectedOnBoard = selected !== null && items.some((it) => it.id === selected);

  // Keyboard: delete the selected reference, Escape lets go
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (selectedOnBoard) actions.commit([{ op: "removeMoodItem", itemId: selected }], { label: "remove reference" });
        setSelected(null);
      } else if (e.key === "Escape") setSelected(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!boardRef.current?.contains(e.target as Node)) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [selected, selectedOnBoard, actions, boardRef]);

  const toggleColour = () => {
    if (colourAt || !colourAnchor) return setColourAt(null);
    const r = colourAnchor.getBoundingClientRect();
    const h = 360; // picker height, so it opens upwards when there's no room below
    setColourAt({
      x: Math.max(16, Math.min(r.right - 280, window.innerWidth - 296)),
      y: r.bottom + 8 + h > window.innerHeight ? Math.max(16, r.top - 8 - h) : r.bottom + 8,
    });
  };
  const closeColour = useCallback(() => setColourAt(null), []);

  const addNote = () => {
    // An empty note, open for writing; null when the board refused it (full)
    const id = actions.addNote();
    setSelected(id);
    setEditing(id);
  };
  // The op names the references on the board now, so a replay arranges only what was seen
  const arrange = (layout: MoodLayout) =>
    actions.commit([{ op: "arrangeMood", layout, itemIds: items.map((it) => it.id) }], { label: `arrange ${layout}` });

  return (
    <BlockShell order={3} className="mt-20">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <DecodeText text="Moodboard" className="t-micro text-text-3" />
          <h2 className="t-display-m mt-2.5">References</h2>
          <p className="t-data mt-2 text-text-3">
            {busy > 0
              ? `Adding ${busy} image${busy > 1 ? "s" : ""}…`
              : `${items.length} ${items.length === 1 ? "reference" : "references"} · drop, paste or browse · images stay in this browser`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass flex h-[44px] items-center gap-0.5 rounded-full p-1">
            <span className="t-micro px-3 text-text-3">Arrange</span>
            {(["masonry", "grid", "collage"] as const).map((l) => (
              <button
                key={l}
                type="button"
                disabled={items.length < 2}
                onClick={() => arrange(l)}
                className="focus-ring t-body-s h-full cursor-pointer rounded-full px-3 text-text-2 capitalize transition-colors hover:bg-black/[0.05] hover:text-text disabled:cursor-default disabled:text-text-4 disabled:hover:bg-transparent"
              >
                <ShuffleText text={l[0].toUpperCase() + l.slice(1)} />
              </button>
            ))}
          </div>
          <div className="glass flex h-[44px] items-center gap-0.5 rounded-full p-1">
            <ToolButton onClick={addNote}>Note</ToolButton>
            <ToolButton ref={setColourAnchor} onClick={toggleColour}>
              Colour
            </ToolButton>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="focus-ring t-body-s h-full cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
            >
              <ShuffleText text="Add images" />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.currentTarget.files ?? []));
              e.currentTarget.value = "";
            }}
          />
          <Popover anchor={colourAnchor} pos={colourAt} onClose={closeColour}>
            <ColorPicker
              onAdd={(hex, name) => {
                actions.addColour(hex, name);
                closeColour();
              }}
            />
          </Popover>
        </div>
      </div>

      <div ref={boardRef}>
        {W > 0 && (
          <motion.div
            className="glass relative"
            style={{ borderRadius: 36 }}
            initial={false}
            animate={{ height }}
            transition={move}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelected(null);
            }}
            onDragOver={(e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!over) setOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
            }}
            onDrop={(e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setOver(false);
              const r = e.currentTarget.getBoundingClientRect();
              addFiles(Array.from(e.dataTransfer.files), { x: (e.clientX - r.left) / W, y: (e.clientY - r.top) / W });
            }}
          >
            {items.length === 0 && <EmptyBoard onBrowse={() => fileRef.current?.click()} />}

            {items.map((it) => (
              <Tile
                key={it.id}
                item={it}
                W={W}
                boardH={height}
                selected={selected === it.id}
                editing={editing === it.id}
                onSelect={() => setSelected(it.id)}
                onEdit={() => setEditing(it.id)}
                onEditEnd={() => setEditing(null)}
                onRemove={() => {
                  actions.commit([{ op: "removeMoodItem", itemId: it.id }], { label: "remove reference" });
                  setSelected(null);
                }}
              />
            ))}

            <AnimatePresence>
              {over && (
                <motion.div
                  className="pointer-events-none absolute inset-3 z-[60] grid place-items-center rounded-[28px] border-[1.5px] border-dashed border-ink bg-white/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="t-body rounded-full bg-ink px-5 py-2.5 text-on-ink">Drop to add</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </BlockShell>
  );
}

function ToolButton({ onClick, children, ref }: { onClick: () => void; children: string; ref?: (el: HTMLButtonElement | null) => void }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="focus-ring t-body-s h-full cursor-pointer rounded-full px-3.5 text-text-2 transition-colors hover:bg-black/[0.05] hover:text-text"
    >
      <ShuffleText text={children} />
    </button>
  );
}

function EmptyBoard({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-[28px] border border-dashed border-line-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="t-title text-text">Drop images here</span>
        <span className="t-body-s max-w-[30ch] text-text-3">
          or paste them, browse your files, or add notes and colours. Drag to arrange, resize from the corner.
        </span>
        <button
          type="button"
          onClick={onBrowse}
          className="focus-ring t-body-s pointer-events-auto mt-2 h-[36px] cursor-pointer rounded-full bg-ink px-4 text-on-ink transition-transform hover:scale-[1.02]"
        >
          <ShuffleText text="Browse images" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Tile — one reference on the board
   ------------------------------------------------------------------ */

function Tile({
  item,
  W,
  boardH,
  selected,
  editing,
  onSelect,
  onEdit,
  onEditEnd,
  onRemove,
}: {
  item: MoodItem;
  W: number;
  boardH: number;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onEditEnd: () => void;
  onRemove: () => void;
}) {
  const { commit } = useActions();
  const controls = useDragControls();
  // Position lives in motion values: drag writes them, the document animates them
  const x = useMotionValue(item.x * W);
  const y = useMotionValue(item.y * W);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const liveRef = useRef<{ w: number; h: number } | null>(null);

  const w = (live?.w ?? item.w) * W;
  const h = (live?.h ?? item.h) * W;

  const onResizeDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const aspect = item.h / item.w;
    const onMove = (ev: PointerEvent) => {
      const nw = clamp(item.w + (ev.clientX - sx) / W, 0.06, 1 - item.x);
      // Images keep their proportions; notes and colours stretch freely
      const nh = item.kind === "image" ? nw * aspect : clamp(item.h + (ev.clientY - sy) / W, 0.05, 3);
      liveRef.current = { w: nw, h: nh };
      setLive(liveRef.current);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (liveRef.current) commit([{ op: "updateMoodItem", itemId: item.id, patch: liveRef.current, toFront: false }], { label: "resize reference" });
      liveRef.current = null;
      setLive(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return (
    <motion.div
      data-mood-id={item.id}
      className={`group absolute top-0 left-0 touch-none ${editing ? "cursor-text" : dragging ? "cursor-grabbing" : "cursor-grab"}`}
      // The selected tile floats above its neighbours so its handles stay reachable
      style={{ x, y, zIndex: dragging ? 50 : selected ? 40 : undefined }}
      initial={{ opacity: 0, scale: 0.9, width: w, height: h, rotate: item.r }}
      animate={{ opacity: 1, scale: dragging ? 1.025 : 1, x: item.x * W, y: item.y * W, width: w, height: h, rotate: item.r }}
      transition={{ ...move, opacity: { duration: 0.4, ease: ease.out }, ...(live ? { width: { duration: 0 }, height: { duration: 0 } } : {}) }}
      drag={!editing}
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      // Numeric limits, not the board ref: Motion rescales ref-constrained items whenever the
      // board resizes, which would shift every tile as the board grows. Below the bottom edge
      // there's slack, so dragging down extends the board.
      dragConstraints={{ left: 0, top: 0, right: Math.max(0, W - w), bottom: Math.max(0, boardH - h + 140) }}
      onPointerDown={(e) => {
        if (editing) return;
        onSelect();
        controls.start(e);
      }}
      onDoubleClick={() => item.kind === "note" && onEdit()}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        // A moved reference goes on top of the stack (v0 raise)
        commit([{ op: "updateMoodItem", itemId: item.id, patch: { x: x.get() / W, y: y.get() / W }, toFront: true }], { label: "move reference" });
      }}
    >
      <div
        className={`h-full w-full overflow-hidden rounded-[18px] transition-shadow duration-300 ${
          dragging ? "shadow-[0_30px_60px_-24px_rgba(0,0,0,0.45)]" : "shadow-[0_14px_34px_-22px_rgba(0,0,0,0.4)]"
        } ${selected ? "outline-[1.5px] outline-offset-[3px] outline-ink outline-solid" : ""}`}
      >
        {item.kind === "image" && <ImageFace asset={item.assetId} />}
        {item.kind === "color" && <ColorFace hex={item.hex ?? "#000000"} name={item.text} width={w} />}
        {item.kind === "note" && <NoteFace item={item} width={w} editing={editing} onEditEnd={onEditEnd} />}
      </div>

      {selected && !dragging && (
        <>
          <button
            type="button"
            aria-label="Remove reference"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
            className="focus-ring absolute -top-[9px] -right-[9px] z-10 grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-full bg-ink text-on-ink transition-[scale] hover:scale-105"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Resize reference"
            onPointerDown={onResizeDown}
            className="absolute -right-[7px] -bottom-[7px] z-10 h-[18px] w-[18px] cursor-nwse-resize touch-none rounded-full border-[1.5px] border-ink bg-white"
          />
        </>
      )}
    </motion.div>
  );
}

/** An `ast_` id; lib/assets falls back to a migrated v0 image's legacy `img-` key */
function ImageFace({ asset }: { asset: string | null }) {
  const { url, missing } = useAssetUrl(asset);
  if (missing) return <Placeholder>Image not stored in this browser</Placeholder>;
  if (!url) return <div className="h-full w-full animate-pulse bg-black/[0.06]" />;
  // eslint-disable-next-line @next/next/no-img-element -- local object URL, nothing for next/image to optimise
  return <img src={url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover select-none" />;
}

function Placeholder({ children }: { children: ReactNode }) {
  return <div className="t-data grid h-full w-full place-items-center bg-black/[0.05] p-3 text-center text-text-3">{children}</div>;
}

/** WCAG 2.x relative luminance of a #rrggbb colour */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The swatch label's ink (Q14): the off-black or the off-white, whichever contrasts more with the
 * swatch; pure black or white for the few mid-tones where neither reaches 4.5:1.
 */
function labelInk(hex: string) {
  const l = luminance(hex);
  const dark = contrast(l, luminance("#0c0c0c"));
  const light = contrast(l, luminance("#f4f3f0"));
  if (Math.max(dark, light) >= 4.5) return dark >= light ? "#0c0c0c" : "#f4f3f0";
  return contrast(l, 0) >= contrast(l, 1) ? "#000000" : "#ffffff";
}

function ColorFace({ hex, name, width }: { hex: string; name: string | null; width: number }) {
  return (
    <div className="flex h-full w-full flex-col justify-end p-3" style={{ background: hex, color: labelInk(hex) }}>
      {/* Too small to label legibly: the chip speaks for itself */}
      {width >= 84 && (
        <>
          {name && <span className="t-body-s truncate">{name}</span>}
          <span className="t-data uppercase">{hex}</span>
        </>
      )}
    </div>
  );
}

function NoteFace({ item, width, editing, onEditEnd }: { item: MoodItem; width: number; editing: boolean; onEditEnd: () => void }) {
  const { commit } = useActions();
  const ref = useRef<HTMLParagraphElement>(null);

  // The text node belongs to the browser while editing; React only writes it when idle
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== (item.text ?? "")) el.textContent = item.text ?? "";
  }, [item.text]);

  // Entering edit mode: focus the text with the caret at the end
  useLayoutEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  return (
    // Type scales with the note, so a small one on a phone still reads as a note
    <div className="glass-hi h-full w-full" style={{ padding: clamp(width * 0.075, 8, 16), fontSize: clamp(width * 0.075, 10, 16) }}>
      <p
        ref={ref}
        contentEditable={editing ? "plaintext-only" : false}
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="Write a note"
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const text = (e.currentTarget.textContent ?? "").trim().slice(0, MOOD_TEXT);
          onEditEnd();
          if (text !== (item.text ?? "")) commit([{ op: "updateMoodItem", itemId: item.id, patch: { text }, toFront: false }], { label: "edit note" });
        }}
        className="h-full overflow-hidden leading-[1.3] tracking-[-0.015em] text-text outline-none empty:before:text-text-3 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
