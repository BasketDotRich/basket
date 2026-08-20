"use client";

import { useEffect, useState } from "react";
import { cls } from "@/lib/format";
import { CandleChart, type CandleData } from "./CandleChart";

const FRAMES = ["15m", "1h", "4h", "1d"] as const;
type Frame = (typeof FRAMES)[number];

export function TokenChartCard({ mint }: { mint: string }) {
  const [frame, setFrame] = useState<Frame>("1h");
  const [candles, setCandles] = useState<CandleData[] | null>(null);

  useEffect(() => {
    let alive = true;
    setCandles(null);
    fetch(`/api/tokens/${mint}/candles?frame=${frame}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setCandles(d?.candles ?? []);
      })
      .catch(() => {
        if (alive) setCandles([]);
      });
    return () => {
      alive = false;
    };
  }, [mint, frame]);

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink2">Price · top pool candles</h2>
        <div className="flex gap-0.5 rounded-md border border-hairline bg-card2 p-0.5 text-xs">
          {FRAMES.map((f) => (
            <button
              key={f}
              onClick={() => setFrame(f)}
              className={cls(
                "rounded px-2.5 py-1 uppercase",
                frame === f ? "bg-card text-ink" : "text-ink3 hover:text-ink2"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {candles == null ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-ink3">Loading candles…</div>
      ) : (
        <CandleChart candles={candles} height={320} />
      )}
      <p className="mt-2 text-[11px] text-ink3">OHLCV from the token&apos;s deepest pool via GeckoTerminal.</p>
    </div>
  );
}
