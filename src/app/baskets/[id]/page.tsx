"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cls, fmtPct, fmtUsd } from "@/lib/format";
import { Delta } from "@/components/Delta";
import { TokenIcon } from "@/components/TokenIcon";
import { LineChart } from "@/components/LineChart";
import { Donut } from "@/components/Donut";
import { InvestPanel } from "@/components/InvestPanel";

type TokenRow = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  weight: number;
  price: number | null;
  change24h: number | null;
  myQty: number;
  myValue: number;
};

type KolPeriod = { profit: number; wins: number; losses: number };
type TraderRowT = {
  id: number;
  name: string;
  wallet: string;
  label: string;
  bio: string;
  twitter: string | null;
  pfp: string | null;
  listed: boolean;
  sourceUrl: string | null;
  seedStats: { daily?: KolPeriod; weekly?: KolPeriod; monthly?: KolPeriod; asOf?: string } | null;
  weight: number;
  valueUsd: number | null;
  solAmount: number | null;
  ret24h: number | null;
  topHoldings: { symbol: string; valueUsd: number }[];
};

type BasketDetail = {
  id: number;
  kind: "coin" | "trader";
  name: string;
  description: string;
  emoji: string;
  horizon?: "short" | "long" | null;
  owner_name: string;
  created_at: number;
  myRule?: { tp_pct: number | null; sl_pct: number | null; close_at: number | null } | null;
  mine: boolean;
  investors: number;
  change24h: number | null;
  tokens?: TokenRow[];
  traders?: TraderRowT[];
  nav?: number;
  myValue: number;
  myCost: number;
  stats?: {
    mcap: number | null;
    volume24h: number | null;
    liquidity: number | null;
    thinnestLeg: { symbol: string; liquidity: number | null } | null;
    coverage: number;
  } | null;
};

export default function BasketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [basket, setBasket] = useState<BasketDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState<{ id: number } | null>(null);
  const [days, setDays] = useState(30);
  const [chart, setChart] = useState<{
    points: [number, number][];
    benchmark?: [number, number][];
    coverage: number;
    source: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [bRes, meRes] = await Promise.all([
        fetch(`/api/baskets/${id}`, { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      if (bRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!bRes.ok) {
        setLoadError("The server had a problem loading this basket.");
        return;
      }
      const bData = await bRes.json();
      const meData = await meRes.json();
      setLoadError(null);
      setBasket(bData.basket);
      setMe(meData.user);
    } catch {
      setLoadError("Couldn’t reach the server.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    setChart(null);
    fetch(`/api/baskets/${id}/chart?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setChart(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, days]);

  if (loadError && !basket) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="mt-3 text-xl font-semibold">{loadError}</h1>
        <button onClick={load} className="btn-brand mt-4 inline-block rounded-xl px-5 py-2.5 text-sm">
          Try again
        </button>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="mt-3 text-xl font-semibold">Basket not found</h1>
        <Link href="/baskets" className="mt-4 inline-block text-brand hover:underline">
          ← Back to baskets
        </Link>
      </div>
    );
  }

  if (!basket) {
    return <div className="mx-auto max-w-6xl px-4 py-24 text-center text-ink3">Loading basket…</div>;
  }

  const pnl = basket.myValue - basket.myCost;
  const pnlPct = basket.myCost > 0 ? (pnl / basket.myCost) * 100 : null;
  const chartPct =
    chart && chart.points.length >= 2
      ? ((chart.points[chart.points.length - 1][1] - chart.points[0][1]) / chart.points[0][1]) * 100
      : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/baskets" className="text-sm text-ink3 hover:text-ink">
        ← All baskets
      </Link>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <div className="flex -space-x-2 pt-1">
          {basket.kind === "coin"
            ? (basket.tokens ?? []).slice(0, 4).map((t) => (
                <TokenIcon key={t.mint} src={t.icon} symbol={t.symbol} size={36} className="rounded-full ring-2 ring-page" />
              ))
            : (basket.traders ?? []).slice(0, 4).map((t) => (
                <span
                  key={t.id}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-card2 text-xs font-semibold text-ink2 ring-2 ring-page"
                >
                  {t.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-[30px]">{basket.name}</h1>
            <span className="rounded-md border border-hairline px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-ink3">
              {basket.kind === "trader" ? "Trader basket" : "Coin basket"}
            </span>
            {basket.kind === "trader" && (
              <span className="rounded-md bg-good/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-good">
                On-chain tracked
              </span>
            )}
            {basket.horizon === "short" && <span className="chip">SHORT-TERM</span>}
            {basket.horizon === "long" && <span className="chip">LONG HOLD</span>}
          </div>
          <p className="mt-1 text-sm text-ink3">
            by @{basket.owner_name} · {basket.investors} investor{basket.investors === 1 ? "" : "s"}
            {basket.kind === "trader" && basket.nav != null && (
              <> · NAV <span className="tabular-nums text-ink2">{basket.nav.toFixed(2)}</span></>
            )}
          </p>
          {basket.description && <p className="mt-2 max-w-2xl text-ink2">{basket.description}</p>}
        </div>
        <div className="text-right">
          <Delta value={basket.change24h} className="text-xl font-semibold" />
          <div className="text-xs uppercase tracking-wider text-ink3">24h</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-ink2">Performance (indexed to 100)</h2>
                {chartPct != null && <Delta value={chartPct} suffix={`${days}d`} />}
              </div>
              <div className="flex gap-1 rounded-lg border border-hairline bg-card2 p-0.5 text-xs">
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={cls(
                      "rounded-md px-2.5 py-1",
                      days === d ? "bg-card text-ink" : "text-ink3 hover:text-ink2"
                    )}
                  >
                    {d}D
                  </button>
                ))}
              </div>
            </div>
            {chart == null ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-ink3">Loading chart…</div>
            ) : (
              <>
                <LineChart
                  points={chart.points}
                  series2={chart.benchmark}
                  seriesLabel={basket.name.slice(0, 18)}
                  series2Label="SOL"
                  height={260}
                  formatValue={(v) => v.toFixed(1)}
                  baselineValue={100}
                />
                <p className="mt-2 text-xs text-ink3">
                  {chart.source === "onchain"
                    ? chart.points.length < 2
                      ? "Tracking just started — the NAV curve builds from real on-chain snapshots (about every 5 minutes)."
                      : "Real on-chain tracked value of the member wallets, snapshotted while tracking runs."
                    : chart.coverage < 0.999
                      ? `Chart covers ${(chart.coverage * 100).toFixed(0)}% of basket weight (history unavailable for the rest).`
                      : "Weighted index of basket tokens, from CoinGecko hourly closes."}
                </p>
              </>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink2">Composition</h2>
            <Donut
              slices={
                basket.kind === "coin"
                  ? (basket.tokens ?? []).map((t) => ({ label: t.symbol, value: t.weight }))
                  : (basket.traders ?? []).map((t) => ({ label: t.name, value: t.weight }))
              }
              centerLabel="Weights"
              formatValue={() => "100%"}
              size={180}
            />

            {basket.kind === "coin" ? (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-ink3">
                      <th className="pb-2 font-medium">Token</th>
                      <th className="pb-2 text-right font-medium">Weight</th>
                      <th className="pb-2 text-right font-medium">Price</th>
                      <th className="pb-2 text-right font-medium">24h</th>
                      <th className="pb-2 text-right font-medium">Your value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(basket.tokens ?? []).map((t) => (
                      <tr key={t.mint} className="border-t border-hairline">
                        <td className="py-2.5">
                          <span className="flex items-center gap-2.5">
                            <TokenIcon src={t.icon} symbol={t.symbol} size={26} />
                            <span>
                              <span className="block font-medium leading-tight">{t.symbol}</span>
                              <span className="block text-xs leading-tight text-ink3">{t.name}</span>
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-ink2">{(t.weight * 100).toFixed(1)}%</td>
                        <td className="py-2.5 text-right tabular-nums">{t.price != null ? fmtUsd(t.price) : "—"}</td>
                        <td className="py-2.5 text-right"><Delta value={t.change24h} /></td>
                        <td className="py-2.5 text-right tabular-nums text-ink2">
                          {t.myValue > 0 ? fmtUsd(t.myValue) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {(basket.traders ?? []).map((t) => (
                  <div key={t.id} className="rounded-lg border border-hairline bg-card2 p-4">
                    <div className="flex items-center gap-3">
                      <TokenIcon src={t.pfp} symbol={t.name} size={34} className="rounded-full" />
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {t.twitter ? (
                            <a href={t.twitter} target="_blank" rel="noreferrer" className="hover:text-brand">{t.name}</a>
                          ) : (
                            t.name
                          )}
                          {t.listed && <span className="chip">KOLSCAN</span>}
                        </div>
                        <div className="text-xs text-ink3">
                          <span className="capitalize">{t.label}</span> · {(t.weight * 100).toFixed(0)}% weight ·{" "}
                          <span className="font-mono">{t.wallet.slice(0, 4)}…{t.wallet.slice(-4)}</span>
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        {t.valueUsd != null ? (
                          <span className="num text-sm font-medium">{fmtUsd(t.valueUsd, { compact: true })}</span>
                        ) : (
                          <span className="text-sm text-ink3">—</span>
                        )}
                        <div className="text-[10px] uppercase tracking-wider text-ink3">tracked value</div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-ink3">
                      24h {t.ret24h != null ? fmtPct(t.ret24h) : "— (building history)"}
                      {t.seedStats?.monthly && (
                        <>
                          {" "}· Kolscan 30d: {t.seedStats.monthly.wins}W/{t.seedStats.monthly.losses}L,{" "}
                          <span className="text-good">+{t.seedStats.monthly.profit.toFixed(0)} SOL</span>
                        </>
                      )}
                    </p>
                    {t.topHoldings.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-1">
                        {t.topHoldings.map((h) => (
                          <span key={h.symbol} className="chip">
                            {h.symbol} {fmtUsd(h.valueUsd, { compact: true })}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {basket.myValue > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink2">Your position</h2>
              <div className="num mt-2 text-2xl font-semibold">{fmtUsd(basket.myValue)}</div>
              <p className="mt-1 text-sm">
                <span className="tabular-nums text-ink3">
                  {pnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(pnl))}{" "}
                </span>
                <Delta value={pnlPct} suffix="vs cost" />
              </p>
            </div>
          )}
          {basket.kind === "coin" ? (
            <InvestPanel
              basketId={basket.id}
              signedIn={me != null}
              myValue={basket.myValue}
              rule={basket.myRule ?? null}
              onDone={load}
            />
          ) : (
            <div className="card p-5 text-[13px] leading-relaxed text-ink2">
              <span className="chip chip-gold mb-2">TRACKING ONLY</span>
              <p className="mt-2">
                Trader baskets track their wallets&apos; real on-chain performance. Copy-trade
                execution — mirroring their entries with your SOL — is coming; nothing is
                investable here yet, and nothing here is simulated.
              </p>
            </div>
          )}
          {basket.mine && basket.investors === 0 && (
            <>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    const res = await fetch(`/api/baskets/${basket.id}`, { method: "DELETE" });
                    if (res.ok) {
                      router.push("/baskets");
                      router.refresh();
                      return;
                    }
                    const d = await res.json().catch(() => ({}));
                    setDeleteError(d.error ?? "Delete failed — try again.");
                  } catch {
                    setDeleteError("Network error — try again.");
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="w-full rounded-xl border border-hairline py-2 text-sm text-ink3 hover:border-bad hover:text-bad"
              >
                {deleting ? "Deleting…" : "Delete this basket"}
              </button>
              {deleteError && (
                <p role="status" className="text-center text-xs text-bad">{deleteError}</p>
              )}
            </>
          )}
          {basket.kind === "coin" && basket.stats && (
            <div className="card p-4">
              <div className="th mb-3">Basket liquidity &amp; size</div>
              <dl className="space-y-2.5">
                {[
                  ["Combined market cap", basket.stats.mcap],
                  ["24h volume", basket.stats.volume24h],
                  ["Pooled liquidity", basket.stats.liquidity],
                ].map(([label, v]) => (
                  <div key={String(label)} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[12px] text-ink3">{label}</dt>
                    <dd className="num text-[13px] font-medium">
                      {typeof v === "number" ? fmtUsd(v, { compact: true }) : "—"}
                    </dd>
                  </div>
                ))}
              </dl>
              {basket.stats.thinnestLeg?.liquidity != null && (
                <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink3">
                  Thinnest leg is{" "}
                  <strong className="text-ink2">{basket.stats.thinnestLeg.symbol}</strong> at{" "}
                  <span className="num">{fmtUsd(basket.stats.thinnestLeg.liquidity, { compact: true })}</span> —
                  that one sets how much you can exit without moving the price.
                </p>
              )}
              {basket.stats.coverage < 1 && (
                <p className="mt-2 text-[11px] text-warn">
                  Liquidity data covers {Math.round(basket.stats.coverage * 100)}% of the basket.
                </p>
              )}
            </div>
          )}

          <div className="card p-5 text-xs leading-relaxed text-ink3">
            {basket.kind === "coin" ? (
              <>Investing executes real Jupiter swaps from your account wallet into every token, weighted like the basket. Redeeming swaps the position back to SOL in your wallet.</>
            ) : (
              <>This basket&apos;s NAV tracks the real on-chain value of the member wallets (SOL, stables and tracked tokens) — live attribution, no simulation.</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
