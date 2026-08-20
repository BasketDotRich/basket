"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type CandleData = { t: number; o: number; h: number; l: number; c: number; v: number };

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
}

function fmtVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtTime(ts: number, spanSec: number): string {
  const d = new Date(ts * 1000);
  if (spanSec <= 2 * 86400) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** OHLCV candles: thin bodies, 1px wicks, volume ribbon, crosshair tooltip. */
export function CandleChart({ candles, height = 320 }: { candles: CandleData[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // measure immediately — ResizeObserver may not fire while the tab is hidden
    setWidth(el.getBoundingClientRect().width || el.clientWidth || 0);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 10, right: 58, bottom: 22, left: 8 };
  const volH = 46;

  const model = useMemo(() => {
    if (candles.length < 2 || width < 120) return null;
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom - volH - 6;
    let lo = Infinity;
    let hi = -Infinity;
    let vMax = 0;
    for (const c of candles) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
      vMax = Math.max(vMax, c.v);
    }
    const span = hi - lo || hi * 0.01 || 1;
    lo -= span * 0.04;
    hi += span * 0.04;
    const n = candles.length;
    const slot = iw / n;
    const bodyW = Math.max(2, Math.min(9, Math.floor(slot * 0.65)));
    const x = (i: number) => pad.left + slot * i + slot / 2;
    const y = (p: number) => pad.top + (1 - (p - lo) / (hi - lo)) * ih;
    const vy = (v: number) => (vMax > 0 ? (v / vMax) * volH : 0);
    const yTicks = [0.1, 0.37, 0.63, 0.9].map((f) => lo + (hi - lo) * f);
    const xTickIdx = [0, 0.33, 0.66, 0.995].map((f) => Math.min(n - 1, Math.floor(n * f)));
    return { iw, ih, n, slot, bodyW, x, y, vy, yTicks, xTickIdx, lo, hi };
  }, [candles, width, height, pad.left, pad.right, pad.top, pad.bottom]);

  if (candles.length < 2) {
    return (
      <div ref={wrapRef} style={{ height }} className="flex items-center justify-center text-sm text-ink3">
        No candle data for this pair yet
      </div>
    );
  }

  const spanSec = candles[candles.length - 1].t - candles[0].t;
  const hc = hover != null ? candles[hover] : null;

  function onMove(e: React.MouseEvent) {
    if (!model || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - pad.left - model.slot / 2) / model.slot);
    setHover(Math.max(0, Math.min(candles.length - 1, i)));
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none"
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {model && (
        <svg role="img" aria-label="Price candlestick chart" width={width} height={height} className="block">
          {model.yTicks.map((p) => (
            <g key={p}>
              <line x1={pad.left} x2={width - pad.right} y1={model.y(p)} y2={model.y(p)} stroke="var(--grid)" strokeWidth="1" />
              <text x={width - pad.right + 6} y={model.y(p) + 3.5} fontSize="10.5" fill="var(--ink3)" className="tabular-nums">
                {fmtPrice(p)}
              </text>
            </g>
          ))}
          {model.xTickIdx.map((i) => (
            <text
              key={i}
              x={model.x(i)}
              y={height - 6}
              textAnchor="middle"
              fontSize="10.5"
              fill="var(--ink3)"
            >
              {fmtTime(candles[i].t, spanSec)}
            </text>
          ))}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? "var(--good)" : "var(--bad)";
            const bodyTop = model.y(Math.max(c.o, c.c));
            const bodyH = Math.max(1, Math.abs(model.y(c.o) - model.y(c.c)));
            const cx = model.x(i);
            return (
              <g key={c.t} opacity={hover == null || hover === i ? 1 : 0.55}>
                <line x1={cx} x2={cx} y1={model.y(c.h)} y2={model.y(c.l)} stroke={color} strokeWidth="1" />
                <rect x={cx - model.bodyW / 2} y={bodyTop} width={model.bodyW} height={bodyH} fill={color} rx="0.5" />
                <rect
                  x={cx - model.bodyW / 2}
                  y={pad.top + model.ih + 6 + (volH - model.vy(c.v))}
                  width={model.bodyW}
                  height={Math.max(1, model.vy(c.v))}
                  fill={color}
                  opacity="0.35"
                />
              </g>
            );
          })}
          {hc && model && (
            <line
              x1={model.x(hover!)}
              x2={model.x(hover!)}
              y1={pad.top}
              y2={pad.top + model.ih + 6 + volH}
              stroke="var(--baseline)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
        </svg>
      )}
      {hc && model && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-hairline bg-card2 px-3 py-2 text-[11px] leading-relaxed shadow-lg"
          style={{ left: Math.min(Math.max(model.x(hover!) - 80, 0), Math.max(width - 190, 0)) }}
        >
          <div className="text-ink3">
            {new Date(hc.t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
          <div className="tabular-nums text-ink2">
            O {fmtPrice(hc.o)} · H {fmtPrice(hc.h)} · L {fmtPrice(hc.l)}
          </div>
          <div className="tabular-nums">
            <span className={hc.c >= hc.o ? "text-good" : "text-bad"}>C {fmtPrice(hc.c)}</span>
            <span className="text-ink3"> · Vol {fmtVol(hc.v)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
