"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary. A page throwing must never show a raw stack or
 * a blank screen — the user gets a way out, and we keep the error in the logs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="chip chip-gold">SOMETHING BROKE</div>
      <h1 className="display mt-4 text-[34px]">This page hit a snag</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
        The error is logged on our side. Your funds and positions are untouched — this is a display
        problem, not a trading one.
      </p>
      {error.digest && (
        <p className="num mt-3 text-[11px] text-ink3">reference: {error.digest}</p>
      )}
      <div className="mt-7 flex flex-wrap justify-center gap-2.5">
        <button onClick={reset} className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          Try again
        </button>
        <Link href="/" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Back to markets
        </Link>
        <Link href="/wallet" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Check my wallet
        </Link>
      </div>
    </div>
  );
}
