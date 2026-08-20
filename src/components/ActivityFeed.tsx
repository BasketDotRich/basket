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

/**
 * Freshness derived from the newest event, never asserted as a constant.
 * Claiming "LIVE · ~5MIN" above hours-old rows is exactly the kind of lie
 * that makes people stop trusting every other number on the page.
 */
function Freshness({ newestTs }: { newestTs: number | null }) {
  if (newestTs == null) return <span className="chip">WATCHING</span>;
  const age = Date.now() - newestTs;
  if (age < 15 * 60_000) {
    return (
      <span className="chip chip-on">
        <span className="live-dot">●</span> LIVE
      </span>
    );
  }
  return <span className="chip">LAST TRADE {timeAgo(newestTs)}</span>;
}

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

  const newestTs = events && events.length > 0 ? events[0].ts : null;

  const header = (
    <div className="mb-1 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-ink2">On-chain activity</h3>
      <Freshness newestTs={newestTs} />
    </div>
  );
  const blurb = (
    <p className="mb-2 text-[11px] text-ink3">
      Position changes detected between wallet snapshots — no feeds, straight from chain.
    </p>
  );

  if (events == null) {
    return (
      <>
        {header}
        {blurb}
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-9 w-full" />
          ))}
        </div>
      </>
    );
  }

  if (events.length === 0) {
    return (
      <>
        {header}
        {blurb}
        <p className="py-6 text-center text-[13px] text-ink3">
          Watching the tracked wallets — a position change shows up here as soon as two
          snapshots disagree.
        </p>
      </>
    );
  }

  return (
    <>
    {header}
    {blurb}
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
  </>
  );
}
