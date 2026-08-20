"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtUsd, timeAgo } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";

type ActivityEvent = {
  id: number;
  ts: number;
  mint: string;
  symbol: string;
  delta_usd: number;
  kind: "buy" | "sell";
  trader_id: number;
  name: string;
  pfp: string | null;
  listed: number;
};

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/activity", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d) setEvents(d.events ?? []);
        })
        .catch(() => {});
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (events == null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-9 w-full" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-ink3">
        Watching the tracked wallets — position changes appear here as snapshots detect them
        (~5 minute resolution).
      </p>
    );
  }

  return (
    <ul className="divide-y divide-hairline">
      {events.slice(0, 14).map((e) => (
        <li key={e.id} className="flex items-center gap-2.5 py-2 text-[13px]">
          <TokenIcon src={e.pfp} symbol={e.name} size={22} className="rounded-full" />
          <Link href={`/traders/${e.trader_id}`} className="font-medium hover:text-brand">
            {e.name}
          </Link>
          <span className={e.kind === "buy" ? "text-good" : "text-bad"}>
            {e.kind === "buy" ? "▲ bought" : "▼ sold"}
          </span>
          <Link href={`/tokens/${e.mint}`} className="font-medium hover:text-brand">
            {e.symbol}
          </Link>
          <span className="num ml-auto text-ink2">
            {e.delta_usd > 0 ? "+" : "−"}
            {fmtUsd(Math.abs(e.delta_usd), { compact: true })}
          </span>
          <span className="num w-16 text-right text-xs text-ink3">{timeAgo(e.ts)}</span>
        </li>
      ))}
    </ul>
  );
}
