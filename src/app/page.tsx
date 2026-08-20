import Link from "next/link";
import { Ticker } from "@/components/Ticker";
import { Hero } from "@/components/Hero";
import { BasketCard } from "@/components/BasketCard";
import { Delta } from "@/components/Delta";
import { TokenIcon } from "@/components/TokenIcon";
import { Sparkline } from "@/components/Sparkline";
import { ActivityFeed } from "@/components/ActivityFeed";
import { MarketsTable, type MarketRow } from "@/components/MarketsTable";
import { getUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CURATED_TOKENS, GENRE_INFO, PLAYSTYLES } from "@/lib/tokens";
import { getMarketsOverview, getMarketStats, getPrices } from "@/lib/prices";
import { SOL_MINT, getWalletValueCached } from "@/lib/wallets";
import { fmtUsd } from "@/lib/format";
import type { TraderRow } from "@/lib/portfolio";
import {
  basketChange24h,
  getBasketTokens,
  getBasketTraders,
  investorCount,
  listBaskets,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type KolSeed = {
  daily?: { profit: number; wins: number; losses: number };
  weekly?: { profit: number; wins: number; losses: number };
  monthly?: { profit: number; wins: number; losses: number };
};

export default async function Home() {
  const user = await getUser();
  const db = getDb();

  const mints = CURATED_TOKENS.map((t) => t.mint);
  const cgIds = CURATED_TOKENS.map((t) => t.coingeckoId).filter((x): x is string => x != null);
  const [prices, stats, overview] = await Promise.all([
    getPrices([...mints, SOL_MINT]),
    getMarketStats(mints),
    getMarketsOverview(cgIds),
  ]);

  const market: MarketRow[] = CURATED_TOKENS.map((t) => {
    const ov = t.coingeckoId ? overview[t.coingeckoId] : undefined;
    return {
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      icon: t.icon,
      genres: t.genres,
      price: prices[t.mint]?.usdPrice ?? ov?.price ?? null,
      change24h: prices[t.mint]?.priceChange24h ?? ov?.change24h ?? null,
      change7d: ov?.change7d ?? null,
      sparkline: ov?.sparkline7d ?? [],
      mcap: stats[t.mint]?.mcap ?? ov?.mcap ?? null,
      volume24h: stats[t.mint]?.volume24h ?? ov?.volume24h ?? null,
      liquidity: stats[t.mint]?.liquidity ?? null,
      launchedAt: t.launchedAt,
    };
  }).sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));

  const totalMcap = market.reduce((s, t) => s + (t.mcap ?? 0), 0);
  const totalVol = market.reduce((s, t) => s + (t.volume24h ?? 0), 0);


  const all = listBaskets(user?.id ?? null);
  const featured = await Promise.all(
    [...all.filter((b) => b.kind === "coin").slice(0, 3), ...all.filter((b) => b.kind === "trader").slice(0, 3)].map(
      async (b) => ({
        ...b,
        tokens: b.kind === "coin" ? getBasketTokens(b.id) : [],
        traders: b.kind === "trader" ? getBasketTraders(b.id) : [],
        change24h: await basketChange24h(b),
        investors: investorCount(b.id),
        mine: user != null && b.owner_id === user.id,
      })
    )
  );

  const kols = db
    .prepare(
      "SELECT id, name, wallet, label, twitter, pfp, seed_stats FROM traders WHERE listed = 1 ORDER BY id ASC"
    )
    .all() as (TraderRow & { twitter: string | null; pfp: string | null })[];
  const board = kols
    .map((k) => ({ ...k, s: (k.seed_stats ? JSON.parse(k.seed_stats) : {}) as KolSeed }))
    .filter((k) => k.s.monthly)
    .sort((a, b) => b.s.monthly!.profit - a.s.monthly!.profit)
    .slice(0, 10);
  const maxPnl = Math.max(...board.map((k) => k.s.monthly!.profit), 1);
  const kolCount = kols.length;

  return (
    <div>
      <Hero
        signedIn={user != null}
        market={market}
        totalMcap={totalMcap}
        totalVol={totalVol}
        kolCount={kolCount}
        basketCount={all.length}
        topBasket={
          featured[0]
            ? { id: featured[0].id, name: featured[0].name, change24h: featured[0].change24h }
            : null
        }
      />

      <Ticker />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-3">
          <h2 className="display text-[26px]">Markets</h2>
          <p className="mt-0.5 text-xs text-ink3">
            {market.length} tracked tokens · genre taxonomy sourced from CoinGecko categories and
            trench culture · click a row for candles
          </p>
        </div>
        <MarketsTable rows={market} genres={GENRE_INFO.map((g) => g.name)} />
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-10">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="display text-[26px]">Baskets</h2>
            <p className="mt-0.5 text-xs text-ink3">
              Genre indices priced on live markets · trader baskets tracked on-chain
            </p>
          </div>
          <Link href="/baskets" className="text-xs text-brand hover:underline">View all →</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((b) => (
            <BasketCard key={b.id} basket={b} />
          ))}
        </div>
      </section>

      <section className="border-t border-hairline bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="display text-[26px]">KOL leaderboard</h2>
              <p className="mt-0.5 text-xs text-ink3">
                {kolCount} wallets from Kolscan&apos;s public leaderboard, monthly PnL ·
                every one selectable in the basket builder
              </p>
            </div>
            <Link href="/baskets/new" className="text-xs text-brand hover:underline">
              Build a trader basket →
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-left">
                    <th className="th py-2 pl-3 font-medium">#</th>
                    <th className="th py-2 font-medium">Trader</th>
                    <th className="th py-2 font-medium">Style</th>
                    <th className="th py-2 font-medium">30d PnL</th>
                    <th className="th py-2 text-right font-medium">30d W/L</th>
                    <th className="th py-2 pr-3 text-right font-medium">Tracked value</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((k, i) => {
                    const live = getWalletValueCached(k.wallet);
                    const m = k.s.monthly!;
                    return (
                      <tr key={k.id} className="border-b border-hairline last:border-0 hover:bg-card2/60">
                        <td className="num py-2 pl-3 text-xs text-ink3">{i + 1}</td>
                        <td className="py-2">
                          <Link href={`/traders/${k.id}`} className="flex items-center gap-2.5 hover:text-brand">
                            <TokenIcon src={k.pfp} symbol={k.name} size={24} className="rounded-full" />
                            <span className="font-medium">{k.name}</span>
                            <span className="chip">KOLSCAN</span>
                          </Link>
                        </td>
                        <td className="py-2"><span className="chip capitalize">{k.label}</span></td>
                        <td className="py-2 pr-4">
                          <div className="num text-good">+{m.profit.toFixed(0)} SOL</div>
                          <div className="pnlbar mt-1 w-24"><i style={{ width: `${(m.profit / maxPnl) * 100}%` }} /></div>
                        </td>
                        <td className="num py-2 text-right text-ink2">{m.wins}W / {m.losses}L</td>
                        <td className="num py-2 pr-3 text-right">
                          {live ? fmtUsd(live.totalUsd, { compact: true }) : <span className="text-ink3">warming…</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card p-4">
              <ActivityFeed />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink3">
            PnL/W-L: kolscan.io monthly board, Aug 20 2026 snapshot · avatars via Kolscan&apos;s CDN ·
            tracked value is live on-chain
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-3">
          <h2 className="display text-[26px]">Strategy playbook</h2>
          <p className="mt-0.5 text-xs text-ink3">The real trench archetypes — build a basket around any of them</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLAYSTYLES.map((p) => (
            <a key={p.name} href={p.source} target="_blank" rel="noreferrer" className="card p-4 hover:border-brand/50">
              <div className="th">{p.name}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">{p.description}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
