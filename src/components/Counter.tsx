"use client";

import { useEffect, useRef, useState } from "react";

// Server components can't hand a function across the RSC boundary, so the
// formatter is named declaratively rather than passed in.
const FORMATS: Record<string, (n: number) => string> = {
  compact: (n) =>
    n >= 1e9
      ? `$${(n / 1e9).toFixed(2)}B`
      : n >= 1e6
        ? `$${(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `$${(n / 1e3).toFixed(0)}K`
          : `$${n.toFixed(0)}`,
  int: (n) => String(Math.round(n)),
  usd: (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
};

/** Rolls a figure up on mount so hero numbers land with some weight. */
export function Counter({
  value,
  format = "int",
  durationMs = 900,
  className,
}: {
  value: number;
  format?: keyof typeof FORMATS;
  durationMs?: number;
  className?: string;
}) {
  const fmt = FORMATS[format] ?? FORMATS.int;
  const [shown, setShown] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutExpo — quick, then settles
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, durationMs]);

  return <span className={className}>{fmt(shown)}</span>;
}
