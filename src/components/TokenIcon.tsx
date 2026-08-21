"use client";

import { useEffect, useState } from "react";
import { cls } from "@/lib/format";

const FALLBACK_BG = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767"];

/** Secondary art source, tried only after the primary one actually fails. */
const dexIcon = (mint: string) =>
  `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png?size=lg`;

export function TokenIcon({
  src,
  symbol,
  size = 28,
  className,
  mint,
}: {
  src: string | null | undefined;
  symbol: string;
  size?: number;
  className?: string;
  /** When given, a failed icon retries DexScreener before falling back to a tile. */
  mint?: string | null;
}) {
  // Build the chain once per input: whatever we were handed, then the
  // DexScreener render of the same mint. Tokens stored before we started
  // reading Jupiter's real icon still have a guessed URL on record, and for
  // young coins that URL 404s — without a second try they'd show a bare letter
  // tile forever.
  const chain = [src?.trim() || null, mint ? dexIcon(mint) : null].filter(
    (u, i, a): u is string => !!u && a.indexOf(u) === i
  );

  const [step, setStep] = useState(0);
  // A new token in the same slot (list re-sort, page change) must start over,
  // or it inherits the previous token's exhausted chain and renders a tile.
  useEffect(() => setStep(0), [chain.join("|")]);

  const current = chain[step];

  if (!current) {
    const bg = FALLBACK_BG[(symbol.charCodeAt(0) || 0) % FALLBACK_BG.length];
    return (
      <span
        className={cls(
          "inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0",
          className
        )}
        style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}
        aria-hidden
      >
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setStep((s) => s + 1)}
      className={cls("rounded-full object-cover shrink-0 bg-card2", className)}
      style={{ width: size, height: size }}
    />
  );
}
