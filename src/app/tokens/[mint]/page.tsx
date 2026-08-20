import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { TOKENS_BY_MINT } from "@/lib/tokens";
import {
  getMarketsOverview,
  getMarketStats,
  getPrices,
  getTokenDetail,
} from "@/lib/prices";
import { fmtUsd } from "@/lib/format";
import { Delta } from "@/components/Delta";
import { TokenIcon } from "@/components/TokenIcon";
import { TokenChartCard } from "@/components/TokenChartCard";

export const dynamic = "force-dynamic";

function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default async function TokenPage(props: PageProps<"/tokens/[mint]">) {
  const { mint } = await props.params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) notFound();

  const db = getDb();
  const curated = TOKENS_BY_MINT[mint];
  const [prices, stats, detail] = await Promise.all([
    getPrices([mint]),
    getMarketStats([mint]),
    getTokenDetail(mint),
  ]);
  const metaRow = curated ??
    (db.prepare("SELECT mint, symbol, name, icon, decimals, coingecko_id AS coingeckoId FROM token_meta WHERE mint = ?").get(mint) as
      | { mint: string; symbol: string; name: string; icon: string | null; coingeckoId: string | null }
      | undefined) ??
    (detail?.symbol
      ? {
          mint,
          symbol: detail.symbol,
          name: detail.name ?? "Unknown token",
          icon: `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png?size=lg`,
          coingeckoId: null,
        }
      : undefined);
  if (!metaRow) notFound();

  const overview = metaRow.coingeckoId ? await getMarketsOverview([metaRow.coingeckoId]) : {};
  const price = prices[mint]?.usdPrice ?? null;
  const ch24 = prices[mint]?.priceChange24h ?? stats[mint]?.priceChange24h ?? null;
  const ov = metaRow.coingeckoId ? (overview as Record<string, { change7d: number | null }>)[metaRow.coingeckoId] : undefined;

  const inBaskets = db
    .prepare(
      `SELECT b.id, b.name, bt.weight FROM basket_tokens bt
       JOIN baskets b ON b.id = bt.basket_id
       WHERE bt.mint = ? AND b.is_public = 1 ORDER BY bt.weight DESC LIMIT 12`
    )
    .all(mint) as { id: number; name: string; weight: number }[];

  const genres = curated?.genres ?? [];

  const statCells: { label: string; value: string; sub?: string }[] = [
    { label: "Market cap", value: compact(stats[mint]?.mcap) },
    { label: "24h volume", value: compact(stats[mint]?.volume24h) },
    { label: "Liquidity", value: compact(stats[mint]?.liquidity) },
    { label: "Holders", value: detail?.holderCount != null ? detail.holderCount.toLocaleString("en-US") : "—" },
    {
      label: "24h flow",
      value:
        detail?.buys24h != null && detail?.sells24h != null
          ? `${detail.buys24h.toLocaleString()}B / ${detail.sells24h.toLocaleString()}S`
          : "—",
      sub: detail?.traders24h != null ? `${detail.traders24h.toLocaleString()} traders` : undefined,
    },
    {
      label: "Top 10 holders",
      value: detail?.topHoldersPct != null ? `${detail.topHoldersPct.toFixed(1)}%` : "—",
      sub: "of supply",
    },
    {
      label: "Organic score",
      value: detail?.organicScore != null ? `${detail.organicScore}/100` : "—",
      sub: "Jupiter",
    },
    {
      label: "Authorities",
      value:
        detail?.mintAuthorityDisabled == null && detail?.freezeAuthorityDisabled == null
          ? "—"
          : `mint ${detail?.mintAuthorityDisabled === false ? "LIVE ⚠" : "revoked"} · freeze ${detail?.freezeAuthorityDisabled === false ? "LIVE ⚠" : "revoked"}`,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/" className="text-xs text-ink3 hover:text-ink">← Markets</Link>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <TokenIcon src={metaRow.icon} symbol={metaRow.symbol} size={44} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display text-[28px]">{metaRow.symbol}</h1>
            <span className="text-sm text-ink3">{metaRow.name}</span>
            {curated?.launchedAt && (
              <span className="chip">
                pump.fun · {new Date(curated.launchedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            )}
            {genres.map((g) => (
              <span key={g} className="chip">{g}</span>
            ))}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-ink3">{mint}</p>
        </div>
        <div className="ml-auto text-right">
          <div className="num text-2xl font-semibold">{price != null ? fmtUsd(price) : "—"}</div>
          <div className="flex items-center justify-end gap-3 text-sm">
            <Delta value={ch24} suffix="24h" />
            <Delta value={ov?.change7d} suffix="7d" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <TokenChartCard mint={mint} />
        </div>
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink2">Token stats</h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
              {statCells.map((s) => (
                <div key={s.label} className="bg-card px-3 py-2.5">
                  <div className="th">{s.label}</div>
                  <div className="mt-0.5 text-[13px] font-medium tabular-nums">{s.value}</div>
                  {s.sub && <div className="text-[10px] text-ink3">{s.sub}</div>}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink3">
              Live: Jupiter (price, holders, audit) · DexScreener (mcap, volume, liquidity)
            </p>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink2">In baskets</h2>
            {inBaskets.length === 0 ? (
              <p className="text-[13px] text-ink3">
                Not in any public basket yet —{" "}
                <Link href="/baskets/new" className="text-brand hover:underline">build one</Link>.
              </p>
            ) : (
              <ul className="divide-y divide-hairline text-[13px]">
                {inBaskets.map((b) => (
                  <li key={b.id}>
                    <Link href={`/baskets/${b.id}`} className="flex items-center justify-between py-2 hover:text-brand">
                      <span className="truncate">{b.name}</span>
                      <span className="tabular-nums text-ink3">{(b.weight * 100).toFixed(0)}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
