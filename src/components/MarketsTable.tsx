"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cls, fmtUsd } from "@/lib/format";
import { Delta } from "./Delta";
import { TokenIcon } from "./TokenIcon";
import { Sparkline } from "./Sparkline";

export type MarketRow = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  genres: string[];
  price: number | null;
  change24h: number | null;
  newListing?: boolean;
  change7d: number | null;
  sparkline: number[];
  mcap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  launchedAt: number | null;
};

function age(ts: number | null): string {
  if (!ts) return "—";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

type SortKey = "mcap" | "volume24h" | "change24h" | "change7d" | "liquidity" | "launchedAt";

function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const POLL_MS = 30_000;

export function MarketsTable({ rows: initialRows, genres }: { rows: MarketRow[]; genres: string[] }) {
  const [rows, setRows] = useState(initialRows);
  const [genre, setGenre] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("mcap");
  const [asc, setAsc] = useState(false);
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const prevPrices = useRef<Map<string, number>>(new Map(initialRows.map((r) => [r.mint, r.price ?? 0])));

  // live polling — real refetch, honest cadence, tick flashes on change
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/tokens?spark=0", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as { tokens: MarketRow[] };
        const next: Record<string, "up" | "down"> = {};
        for (const t of d.tokens) {
          const prev = prevPrices.current.get(t.mint);
          if (prev != null && t.price != null && t.price !== prev) {
            next[t.mint] = t.price > prev ? "up" : "down";
          }
          prevPrices.current.set(t.mint, t.price ?? 0);
        }
        // ?spark=0 omits sparklines to keep the poll light — merge the
        // sparkline we already have for each mint back in
        setRows((prev) => {
          const sparkByMint = new Map(prev.map((r) => [r.mint, r.sparkline]));
          return d.tokens.map((t) => ({
            ...t,
            sparkline: t.sparkline?.length ? t.sparkline : (sparkByMint.get(t.mint) ?? []),
          }));
        });
        setFlashes(next);
        setUpdatedAt(Date.now());
        setTimeout(() => setFlashes({}), 1200);
      } catch {
        // next tick retries
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const shown = useMemo(() => {
    let list = rows;
    if (genre) list = list.filter((r) => r.genres.includes(genre));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return asc ? av - bv : bv - av;
    });
  }, [rows, genre, query, sortKey, asc]);

  const header = (label: string, key: SortKey, align = "text-right") => (
    <th
      className={cls("th py-2 font-medium", align)}
      aria-sort={sortKey === key ? (asc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="cursor-pointer select-none hover:text-ink2"
        onClick={() => {
          if (sortKey === key) setAsc(!asc);
          else {
            setSortKey(key);
            setAsc(false);
          }
        }}
      >
        {label}
        {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setGenre(null)}
          className={cls("chip", genre == null && "chip-on")}
        >
          ALL · {rows.length}
        </button>
        {genres.map((g) => {
          const count = rows.filter((r) => r.genres.includes(g)).length;
          if (count === 0) return null;
          return (
            <button key={g} onClick={() => setGenre(genre === g ? null : g)} className={cls("chip", genre === g && "chip-on")}>
              {g.toUpperCase()} · {count}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-2 text-[10.5px] text-ink3">
          {updatedAt && (
            <span className="num">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-good align-middle" aria-hidden />
              {new Date(updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-32 rounded-md border border-hairline bg-card px-2.5 py-1 text-xs outline-none placeholder:text-ink3 focus:border-brand"
          />
        </span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left">
              <th className="th py-2 pl-3 font-medium">#</th>
              <th className="th py-2 font-medium">Token</th>
              <th className="th py-2 text-right font-medium">Price</th>
              {header("24h", "change24h")}
              {header("7d", "change7d")}
              <th className="th py-2 pl-6 font-medium">Last 7d</th>
              {header("Mcap", "mcap")}
              {header("Volume", "volume24h")}
              {header("Liq", "liquidity")}
              {header("Age", "launchedAt")}
              <th className="th py-2 pl-5 pr-3 font-medium">Genres</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t, i) => (
              <tr
                key={t.mint}
                className={cls(
                  "group border-b border-hairline last:border-0 hover:bg-card2/60",
                  flashes[t.mint] === "up" && "flash-up",
                  flashes[t.mint] === "down" && "flash-down"
                )}
              >
                <td className="num py-0 pl-3 text-xs text-ink3">{i + 1}</td>
                <td className="py-0">
                  <Link href={`/tokens/${t.mint}`} className="flex items-center gap-2 py-2">
                    <TokenIcon src={t.icon} mint={t.mint} symbol={t.symbol} size={22} />
                    <span className="font-medium group-hover:text-brand">{t.symbol}</span>
                    <span className="hidden max-w-36 truncate text-ink3 xl:inline">{t.name}</span>
                  </Link>
                </td>
                <td className="num py-2 text-right">{t.price != null ? fmtUsd(t.price) : "—"}</td>
                <td className="py-2 text-right">
                  {t.newListing ? (
                    <span className="chip chip-gold" title="Listed less than 24h ago — no meaningful 24h change yet">
                      NEW
                    </span>
                  ) : (
                    <Delta value={t.change24h} className="num text-xs" />
                  )}
                </td>
                <td className="py-2 text-right"><Delta value={t.change7d} className="num text-xs" /></td>
                <td className="py-2 pl-6"><Sparkline data={t.sparkline} width={92} height={24} /></td>
                <td className="num py-2 text-right text-ink2">{compact(t.mcap)}</td>
                <td className="num py-2 text-right text-ink2">{compact(t.volume24h)}</td>
                <td className="num py-2 text-right text-ink2">{compact(t.liquidity)}</td>
                <td className="num py-2 text-right text-ink3">{age(t.launchedAt)}</td>
                <td className="py-2 pl-5 pr-3">
                  <span className="flex gap-1">
                    {t.genres.slice(0, 2).map((g) => (
                      <span key={g} className="chip">{g}</span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-sm text-ink3">
                  Nothing matches — clear the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
