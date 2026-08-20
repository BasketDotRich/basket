"use client";

import { useEffect, useRef, useState } from "react";
import { cls, fmtUsd } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";
import { Delta } from "./Delta";

export type PickerToken = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals?: number;
  price: number | null;
  mcap: number | null;
  change24h: number | null;
  verified?: boolean;
  organic?: number;
  curated?: boolean;
};

const SOURCES = [
  { key: "curated", label: "Curated" },
  { key: "trending", label: "Trending" },
  { key: "organic", label: "Organic" },
  { key: "new", label: "New" },
] as const;
type SourceKey = (typeof SOURCES)[number]["key"];

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function compact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Any Solana token can go into a basket, so the picker offers real discovery
 * feeds plus full search plus paste-a-mint — the curated list is just one tab.
 * Risk is labelled (unverified / low organic score), never hidden.
 */
export function TokenPicker({
  curated,
  isPicked,
  onPick,
}: {
  curated: PickerToken[];
  isPicked: (mint: string) => boolean;
  onPick: (t: PickerToken) => void;
}) {
  const [source, setSource] = useState<SourceKey>("curated");
  const [feedCache, setFeedCache] = useState<Partial<Record<SourceKey, PickerToken[]>>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerToken[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // load a discovery feed on demand
  useEffect(() => {
    if (source === "curated" || feedCache[source]) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/tokens/discover?feed=${source}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setFeedCache((c) => ({ ...c, [source]: d.tokens ?? [] }));
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, feedCache]);

  // search everything Jupiter can route, incl. a pasted mint address
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setNote(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tokens/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const d = await res.json();
        if (ctrl.signal.aborted) return;
        const list: PickerToken[] = d.tokens ?? [];
        setResults(list);
        setNote(
          list.length === 0 && MINT_RE.test(q)
            ? "No token found at that mint address."
            : list.length === 0
              ? "Nothing matched — try a ticker or paste a mint address."
              : null
        );
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      ctrl.abort();
    };
  }, [query]);

  const shown = results ?? (source === "curated" ? curated : feedCache[source] ?? []);

  return (
    <div>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any Solana token, or paste a mint address…"
          aria-label="Search tokens"
          className="w-full rounded-xl border border-hairline bg-card px-4 py-3 pr-9 text-sm outline-none placeholder:text-ink3 focus:border-brand"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {!results && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={cls("chip", source === s.key && "chip-on")}
            >
              {s.label.toUpperCase()}
            </button>
          ))}
          <span className="ml-auto self-center text-[10.5px] text-ink3">
            {source === "new"
              ? "Fresh listings — highest risk"
              : source === "curated"
                ? `${curated.length} verified pump.fun graduates`
                : "Live from Jupiter"}
          </span>
        </div>
      )}
      {results && (
        <p className="mt-2 text-[10.5px] text-ink3">
          {results.length} result{results.length === 1 ? "" : "s"} across all of Solana
        </p>
      )}

      <div className="mt-2 max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
        {loading && shown.length === 0 && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-[52px] w-full" />
            ))}
          </>
        )}
        {!loading && shown.length === 0 && (
          <p className="py-8 text-center text-sm text-ink3">{note ?? "Nothing to show."}</p>
        )}
        {shown.map((t) => {
          const added = isPicked(t.mint);
          const risky = t.verified === false || (t.organic != null && t.organic < 40);
          return (
            <button
              key={t.mint}
              disabled={added}
              onClick={() => onPick(t)}
              className={cls(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                added
                  ? "border-brand/40 bg-brand/10 opacity-60"
                  : "border-hairline bg-card hover:border-brand/60"
              )}
            >
              <TokenIcon src={t.icon} symbol={t.symbol} size={30} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium leading-tight">
                  {t.symbol}
                  {t.curated && <span className="chip">CURATED</span>}
                  {risky && (
                    <span className="chip" style={{ color: "var(--warn)", borderColor: "rgba(240,180,41,0.4)" }}>
                      UNVERIFIED
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs leading-tight text-ink3">{t.name}</span>
              </span>
              <span className="ml-auto shrink-0 text-right">
                <span className="num block text-sm">{t.price != null ? fmtUsd(t.price) : "—"}</span>
                <span className="flex items-center justify-end gap-1.5">
                  <Delta value={t.change24h} className="num text-[11px]" />
                  <span className="num text-[10.5px] text-ink3">{compact(t.mcap)}</span>
                </span>
              </span>
              <span className="ml-1 shrink-0 text-lg text-ink3">{added ? "✓" : "+"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
