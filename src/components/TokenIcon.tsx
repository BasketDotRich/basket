"use client";

import { useState } from "react";
import { cls } from "@/lib/format";

const FALLBACK_BG = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767"];

export function TokenIcon({
  src,
  symbol,
  size = 28,
  className,
}: {
  src: string | null | undefined;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const bg = FALLBACK_BG[(symbol.charCodeAt(0) || 0) % FALLBACK_BG.length];
    return (
      <span
        className={cls("inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0", className)}
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
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cls("rounded-full object-cover shrink-0 bg-card2", className)}
      style={{ width: size, height: size }}
    />
  );
}
