// Shared market-row assembly: curated universe merged with live prices,
// DexScreener stats and CoinGecko 7d overview. Used by the landing page
// and by /api/tokens (which the live poller and the builder consume).
import { CURATED_TOKENS } from "./tokens";
import { getMarketsOverview, getMarketStats, getPrices } from "./prices";
import { SOL_MINT } from "./wallets";

export type MarketRowData = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  genres: string[];
  price: number | null;
  change24h: number | null;
  /** true when the 24h figure is meaningless because the token listed <24h ago */
  newListing?: boolean;
  change7d: number | null;
  sparkline: number[];
  mcap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  launchedAt: number | null;
};

export async function getMarketRows(): Promise<{
  rows: MarketRowData[];
  sol: { price: number | null; change24h: number | null };
}> {
  const mints = CURATED_TOKENS.map((t) => t.mint);
  const cgIds = CURATED_TOKENS.map((t) => t.coingeckoId).filter((x): x is string => x != null);
  const [prices, stats, overview] = await Promise.all([
    getPrices([...mints, SOL_MINT]),
    getMarketStats(mints),
    getMarketsOverview(cgIds),
  ]);
  const rows = CURATED_TOKENS.map((t) => {
    const ov = t.coingeckoId ? overview[t.coingeckoId] : undefined;
    // A five-figure "24h change" means the token had no price yesterday —
    // that's a listing artifact, not performance. Label it, don't print it.
    const rawCh =
      prices[t.mint]?.priceChange24h ?? stats[t.mint]?.priceChange24h ?? ov?.change24h ?? null;
    return {
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      icon: t.icon,
      genres: t.genres,
      price: prices[t.mint]?.usdPrice ?? stats[t.mint]?.price ?? ov?.price ?? null,
      change24h: rawCh != null && Math.abs(rawCh) <= 400 ? rawCh : null,
      newListing: rawCh != null && Math.abs(rawCh) > 400,
      change7d: ov?.change7d ?? null,
      sparkline: ov?.sparkline7d ?? [],
      mcap: stats[t.mint]?.mcap ?? ov?.mcap ?? null,
      volume24h: stats[t.mint]?.volume24h ?? ov?.volume24h ?? null,
      liquidity: stats[t.mint]?.liquidity ?? null,
      launchedAt: t.launchedAt,
    };
  }).sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
  return {
    rows,
    sol: {
      price: prices[SOL_MINT]?.usdPrice ?? null,
      change24h: prices[SOL_MINT]?.priceChange24h ?? null,
    },
  };
}
