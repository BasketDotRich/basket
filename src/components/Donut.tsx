"use client";

import { useMemo, useState } from "react";
import { cls } from "@/lib/format";

// Fixed categorical order (validated dark palette); >7 slices fold into "Other".
const SLICE_COLORS = [
  "var(--s1)",
  "var(--s2)",
  "var(--s3)",
  "var(--s4)",
  "var(--s5)",
  "var(--s6)",
  "var(--s7)",
  "var(--s8)",
];

export type DonutSlice = { label: string; value: number };

// Server components can't pass functions across the RSC boundary — they use
// the declarative `format` prop instead of `formatValue`.
const FORMATTERS: Record<string, (v: number) => string> = {
  number: (v) => v.toFixed(0),
  percent: () => "100%",
  "usd-compact": (v) =>
    Math.abs(v) >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(2)}M`
      : Math.abs(v) >= 10_000
        ? `$${(v / 1_000).toFixed(1)}K`
        : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
};

function arcPath(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): string {
  // a full-circle arc has coincident endpoints and renders as nothing —
  // clamp the sweep so a 100% slice still draws the whole ring
  a1 = Math.min(a1, a0 + Math.PI * 2 - 1e-4);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const xi1 = cx + ri * Math.cos(a1);
  const yi1 = cy + ri * Math.sin(a1);
  const xi0 = cx + ri * Math.cos(a0);
  const yi0 = cy + ri * Math.sin(a0);
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${ri},${ri} 0 ${large} 0 ${xi0},${yi0} Z`;
}

export function Donut({
  slices,
  size = 200,
  centerLabel,
  formatValue,
  format = "number",
}: {
  slices: DonutSlice[];
  size?: number;
  centerLabel?: string;
  formatValue?: (v: number) => string;
  format?: keyof typeof FORMATTERS;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const fmt = formatValue ?? FORMATTERS[format] ?? FORMATTERS.number;

  const model = useMemo(() => {
    const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
    const shown = positive.slice(0, 7);
    const rest = positive.slice(7);
    if (rest.length > 0) {
      shown.push({ label: "Other", value: rest.reduce((s, x) => s + x.value, 0) });
    }
    const total = shown.reduce((s, x) => s + x.value, 0);
    let angle = -Math.PI / 2;
    const arcs = shown.map((s, i) => {
      const frac = total > 0 ? s.value / total : 0;
      const a0 = angle;
      const a1 = angle + frac * Math.PI * 2;
      angle = a1;
      return { ...s, frac, a0, a1, color: SLICE_COLORS[i % SLICE_COLORS.length] };
    });
    return { arcs, total };
  }, [slices]);

  if (model.total <= 0) {
    return <div className="text-sm text-ink3">Nothing to show yet</div>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const ri = r * 0.62;
  const active = hover != null ? model.arcs[hover] : null;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} className="shrink-0">
        {model.arcs.map((a, i) => (
          <path
            key={`${a.label}-${i}`}
            d={arcPath(cx, cy, hover === i ? r : r - 2, ri, a.a0, a.a1)}
            fill={a.color}
            stroke="var(--card)"
            strokeWidth="2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "default", transition: "d 0.1s" }}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="12" fill="var(--ink3)">
          {active ? active.label : centerLabel ?? "Total"}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="16"
          fontWeight="600"
          fill="var(--ink)"
          className="tabular-nums"
        >
          {active ? `${(active.frac * 100).toFixed(1)}%` : fmt(model.total)}
        </text>
      </svg>
      <ul className="min-w-40 space-y-1.5 text-sm">
        {model.arcs.map((a, i) => (
          <li
            key={`${a.label}-${i}`}
            className={cls(
              "flex items-center gap-2 rounded px-1 -mx-1",
              hover === i && "bg-card2"
            )}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: a.color }}
              aria-hidden
            />
            <span className="text-ink2 truncate max-w-36">{a.label}</span>
            <span className="ml-auto tabular-nums text-ink3">{(a.frac * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
