"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Point = [ts: number, value: number];

// Server components can't pass functions across the RSC boundary — they use
// the declarative `format` prop instead of `formatValue`.
const FORMATTERS: Record<string, (v: number) => string> = {
  index: (v) => v.toFixed(1),
  usd: (v) =>
    v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
  "usd-compact": (v) =>
    Math.abs(v) >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(2)}M`
      : Math.abs(v) >= 10_000
        ? `$${(v / 1_000).toFixed(1)}K`
        : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
};

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const s = step * mult;
  const start = Math.ceil(min / s) * s;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += s) ticks.push(v);
  return ticks;
}

function fmtTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 36 * 3600_000) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Single-series line chart: 2px line, subtle area, hairline grid,
 * crosshair + tooltip on hover. No legend — the title names the series.
 */
export function LineChart({
  points,
  height = 240,
  color = "var(--s1)",
  formatValue,
  format = "index",
  baselineValue,
  series2,
  seriesLabel,
  series2Label,
}: {
  points: Point[];
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
  format?: keyof typeof FORMATTERS;
  /** optional dashed reference line (e.g. cost basis or index=100) */
  baselineValue?: number;
  /** optional benchmark series drawn muted+dashed on the same scale */
  series2?: Point[];
  seriesLabel?: string;
  series2Label?: string;
}) {
  const fmt = formatValue ?? FORMATTERS[format] ?? FORMATTERS.index;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const gradId = "lc" + useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // measure immediately — ResizeObserver may not fire while the tab is hidden
    setWidth(el.getBoundingClientRect().width || el.clientWidth || 0);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 12, right: 12, bottom: 22, left: 46 };

  const model = useMemo(() => {
    if (points.length < 2 || width < 80) return null;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const xMin = xs[0];
    const xMax = xs[xs.length - 1];
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    // benchmark is clipped to the primary series' x-window first, so the
    // y-domain is widened only by points that are actually drawn
    const bench =
      series2 && series2.length >= 2
        ? series2.filter((p) => p[0] >= xMin && p[0] <= xMax)
        : [];
    for (const [, v] of bench) {
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    }
    if (baselineValue != null) {
      yMin = Math.min(yMin, baselineValue);
      yMax = Math.max(yMax, baselineValue);
    }
    const yPadding = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.05 || 1;
    yMin -= yPadding;
    yMax += yPadding;
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom;
    const x = (ts: number) => pad.left + ((ts - xMin) / (xMax - xMin || 1)) * iw;
    const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
    const path2 =
      bench.length >= 2
        ? bench.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ")
        : null;
    const area = `${path} L${x(xMax).toFixed(1)},${(pad.top + ih).toFixed(1)} L${x(xMin).toFixed(1)},${(pad.top + ih).toFixed(1)} Z`;
    const yTicks = niceTicks(yMin, yMax, 4);
    const xTickCount = Math.max(2, Math.min(5, Math.floor(iw / 120)));
    const xTicks = Array.from({ length: xTickCount }, (_, i) =>
      xMin + ((xMax - xMin) * i) / (xTickCount - 1)
    );
    return { x, y, path, path2, area, xMin, xMax, yMin, yMax, yTicks, xTicks, ih, iw };
  }, [points, series2, width, height, baselineValue, pad.left, pad.right, pad.top, pad.bottom]);

  const hoverPoint = hover != null && model ? points[hover] : null;

  function onMove(e: React.MouseEvent) {
    if (!model || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = model.xMin + ((px - pad.left) / (model.iw || 1)) * (model.xMax - model.xMin);
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(points[lo - 1][0] - t) < Math.abs(points[lo][0] - t)) lo -= 1;
    setHover(lo);
  }

  if (points.length < 2) {
    return (
      <div ref={wrapRef} style={{ height }} className="flex items-center justify-center text-sm text-ink3">
        Not enough data to chart yet
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none"
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {series2 && series2.length >= 2 && (
        <div className="absolute right-1 top-0 z-10 flex items-center gap-3 text-[10.5px] text-ink3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
            {seriesLabel ?? "Basket"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-ink3" />
            {series2Label ?? "SOL"}
          </span>
        </div>
      )}
      {model && (
        <svg width={width} height={height} className="block" role="img" aria-label="Performance line chart">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {model.yTicks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={model.y(t)}
                y2={model.y(t)}
                stroke="var(--grid)"
                strokeWidth="1"
              />
              <text
                x={pad.left - 8}
                y={model.y(t) + 3.5}
                textAnchor="end"
                fontSize="11"
                fill="var(--ink3)"
                className="tabular-nums"
              >
                {fmt(t)}
              </text>
            </g>
          ))}
          {model.xTicks.map((t, i) => (
            <text
              key={i}
              x={model.x(t)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === model.xTicks.length - 1 ? "end" : "middle"}
              fontSize="11"
              fill="var(--ink3)"
            >
              {fmtTime(t, model.xMax - model.xMin)}
            </text>
          ))}
          {baselineValue != null && (
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={model.y(baselineValue)}
              y2={model.y(baselineValue)}
              stroke="var(--baseline)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}
          <path d={model.area} fill={`url(#${gradId})`} />
          {model.path2 && (
            <path
              d={model.path2}
              fill="none"
              stroke="var(--ink3)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
              strokeLinejoin="round"
              opacity="0.8"
            />
          )}
          <path d={model.path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {hoverPoint && (
            <g>
              <line
                x1={model.x(hoverPoint[0])}
                x2={model.x(hoverPoint[0])}
                y1={pad.top}
                y2={height - pad.bottom}
                stroke="var(--baseline)"
                strokeWidth="1"
              />
              <circle
                cx={model.x(hoverPoint[0])}
                cy={model.y(hoverPoint[1])}
                r="4"
                fill={color}
                stroke="var(--card)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>
      )}
      {hoverPoint && model && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-hairline bg-card2 px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(model.x(hoverPoint[0]) - 60, 0), Math.max(width - 130, 0)),
            top: Math.max(model.y(hoverPoint[1]) - 56, 0),
          }}
        >
          <div className="text-ink3">
            {new Date(hoverPoint[0]).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink">{fmt(hoverPoint[1])}</div>
        </div>
      )}
    </div>
  );
}
