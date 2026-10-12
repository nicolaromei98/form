import { RING, RING_R } from "./geometry";

/** The agent's ring, miniaturised. White on ink, or ink on paper. */
export function AgentMark({ size = 24, tone = "light", className }: { size?: number; tone?: "light" | "dark"; className?: string }) {
  const s = size / ((RING_R + 40) * 2);
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden>
      {RING.map(({ a, r }, i) => {
        const rad = (a * Math.PI) / 180;
        return (
          <circle
            key={i}
            cx={c + Math.cos(rad) * RING_R * s}
            cy={c + Math.sin(rad) * RING_R * s}
            r={r * s * 0.92}
            fill={tone === "light" ? "var(--on-ink)" : "var(--ink)"}
          />
        );
      })}
    </svg>
  );
}
