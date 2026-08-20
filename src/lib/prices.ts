// Market data layer.
// Live prices:   Jupiter lite API  (no key, batched, 30s cache)
// Market stats:  DexScreener       (no key, batched, 2min cache)
// History:       CoinGecko free    (no key, throttled queue, 30min cache)
import { TOKENS_BY_MINT } from "./tokens";

export type LivePrice = { usdPrice: number; priceChange24h: number | null };
export type MarketStats = {
  mcap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
};
export type SeriesPoint = [ts: number, value: number];

type CacheEntry<T> = { data: T; ts: number };

export type MarketOverview = {
  cgId: string;
  price: number | null;
  mcap: number | null;
  volume24h: number | null;
  change24h: number | null;
  change7d: number | null;
  sparkline7d: number[];
};

declare global {
  // eslint-disable-next-line no-var
  var __mbPriceCache: Map<string, CacheEntry<LivePrice>> | undefined;
  // eslint-disable-next-line no-var
  var __mbStatsCache: Map<string, CacheEntry<MarketStats>> | undefined;
  // eslint-disable-next-line no-var
  var __mbHistoryCache: Map<string, CacheEntry<SeriesPoint[]>> | undefined;
  // eslint-disable-next-line no-var
  var __mbCgQueue: Promise<unknown> | undefined;
  // eslint-disable-next-line no-var
  var __mbMarketsCache: Map<string, CacheEntry<Record<string, MarketOverview>>> | undefined;
  // eslint-disable-next-line no-var
  var __mbPriceInFlight:
    | Map<string, Promise<Record<string, { usdPrice: number; priceChange24h?: number }>>>
    | undefined;
  // eslint-disable-next-line no-var
  var __mbMintHistoryCache: Map<string, CacheEntry<SeriesPoint[]>> | undefined;
}

const priceCache = (globalThis.__mbPriceCache ??= new Map());
const priceInFlight = (globalThis.__mbPriceInFlight ??= new Map());
const mintHistoryCache = (globalThis.__mbMintHistoryCache ??= new Map());
const statsCache = (globalThis.__mbStatsCache ??= new Map());
const historyCache = (globalThis.__mbHistoryCache ??= new Map());

const PRICE_TTL = 30_000;
const STATS_TTL = 120_000;
const HISTORY_TTL = 30 * 60_000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Batched live prices from Jupiter. Falls back to stale cache on failure —
 * unbounded for display paths, capped via `maxStaleMs` for trade execution.
 */
export async function getPrices(
  mints: string[],
  opts: { maxStaleMs?: number } = {}
): Promise<Record<string, LivePrice>> {
  const unique = [...new Set(mints)];
  const now = Date.now();
  const result: Record<string, LivePrice> = {};
  const missing: string[] = [];

  for (const mint of unique) {
    const hit = priceCache.get(mint);
    if (hit && now - hit.ts < PRICE_TTL) result[mint] = hit.data;
    else missing.push(mint);
  }

  if (missing.length > 0) {
    await Promise.all(
      chunk(missing, 50).map(async (group) => {
        try {
          // Coalesce concurrent cold callers onto one upstream request per
          // chunk — otherwise every request in a burst stampedes Jupiter.
          const flightKey = group.join(",");
          let flight = priceInFlight.get(flightKey);
          if (!flight) {
            flight = fetch(`https://lite-api.jup.ag/price/v3?ids=${flightKey}`, {
              signal: AbortSignal.timeout(10_000),
              cache: "no-store",
            })
              .then(async (res) => {
                if (!res.ok) throw new Error(`jupiter ${res.status}`);
                return (await res.json()) as Record<
                  string,
                  { usdPrice: number; priceChange24h?: number }
                >;
              })
              .finally(() => priceInFlight.delete(flightKey));
            priceInFlight.set(flightKey, flight);
          }
          const data = await flight;
          for (const mint of group) {
            const p = data[mint];
            if (p && Number.isFinite(p.usdPrice)) {
              const entry: LivePrice = {
                usdPrice: p.usdPrice,
                priceChange24h: Number.isFinite(p.priceChange24h) ? p.priceChange24h! : null,
              };
              priceCache.set(mint, { data: entry, ts: now });
              result[mint] = entry;
            }
          }
        } catch {
          // upstream failed entirely — nothing cached fresh for this group
        }
        // Stale fallback for anything still unpriced — this must run on BOTH
        // paths: a 200 that simply omits the mint (delisted, low liquidity)
        // is just as "unavailable" as a network failure.
        for (const mint of group) {
          if (result[mint]) continue;
          const stale = priceCache.get(mint);
          if (stale && (opts.maxStaleMs == null || now - stale.ts <= opts.maxStaleMs)) {
            result[mint] = stale.data;
          }
        }
      })
    );
  }
  return result;
}

/** Market cap / volume / liquidity from DexScreener (best pair by liquidity). */
export async function getMarketStats(mints: string[]): Promise<Record<string, MarketStats>> {
  const unique = [...new Set(mints)];
  const now = Date.now();
  const result: Record<string, MarketStats> = {};
  const missing: string[] = [];

  for (const mint of unique) {
    const hit = statsCache.get(mint);
    if (hit && now - hit.ts < STATS_TTL) result[mint] = hit.data;
    else missing.push(mint);
  }

  if (missing.length > 0) {
    await Promise.all(
      chunk(missing, 30).map(async (group) => {
        try {
          const res = await fetch(
            `https://api.dexscreener.com/tokens/v1/solana/${group.join(",")}`,
            { signal: AbortSignal.timeout(10_000), cache: "no-store" }
          );
          if (!res.ok) throw new Error(`dexscreener ${res.status}`);
          const pairs = (await res.json()) as Array<{
            baseToken?: { address?: string };
            liquidity?: { usd?: number };
            volume?: { h24?: number };
            priceChange?: { h24?: number };
            marketCap?: number;
            fdv?: number;
          }>;
          const best = new Map<string, (typeof pairs)[number]>();
          for (const pair of pairs ?? []) {
            const addr = pair.baseToken?.address;
            if (!addr || !group.includes(addr)) continue;
            const prev = best.get(addr);
            if (!prev || (pair.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) {
              best.set(addr, pair);
            }
          }
          for (const mint of group) {
            const pair = best.get(mint);
            const entry: MarketStats = {
              mcap: pair?.marketCap ?? pair?.fdv ?? null,
              volume24h: pair?.volume?.h24 ?? null,
              liquidity: pair?.liquidity?.usd ?? null,
              priceChange24h: pair?.priceChange?.h24 ?? null,
            };
            statsCache.set(mint, { data: entry, ts: now });
            result[mint] = entry;
          }
        } catch {
          for (const mint of group) {
            const stale = statsCache.get(mint);
            if (stale) result[mint] = stale.data;
          }
        }
      })
    );
  }
  return result;
}

/**
 * CoinGecko fetch queue. Takes an API PATH (e.g. "/coins/markets?...").
 * A configured key may be Pro or Demo — the client auto-detects: on the
 * key-mismatch 400s (10010/10011) it flips host+header and retries once.
 * Keyless stays conservatively serialized.
 */
declare global {
  // eslint-disable-next-line no-var
  var __mbCgPro: boolean | undefined;
}

async function cgRequest(path: string): Promise<Response> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const doFetch = (pro: boolean) =>
    fetch(
      `${pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3"}${path}`,
      {
        headers: {
          accept: "application/json",
          ...(apiKey ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: apiKey } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      }
    );
  let pro = globalThis.__mbCgPro ?? false;
  let res = await doFetch(pro);
  if (apiKey && res.status === 400) {
    const body = await res.text();
    if (body.includes("10010") || body.includes("10011") || body.includes("pro-api")) {
      pro = !pro;
      globalThis.__mbCgPro = pro;
      res = await doFetch(pro);
    }
  }
  return res;
}

function cgFetch(path: string): Promise<unknown> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const gapMs = apiKey ? 150 : 1500;
  const queue = globalThis.__mbCgQueue ?? Promise.resolve();
  const run = queue.then(async () => {
    const res = await cgRequest(path);
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    return res.json();
  });
  globalThis.__mbCgQueue = run.then(
    () => new Promise((r) => setTimeout(r, gapMs)),
    () => new Promise((r) => setTimeout(r, gapMs))
  );
  return run;
}

/** Price history for one token, [ts, usd][]. Empty array = unavailable. */
export async function getHistory(coingeckoId: string, days: number): Promise<SeriesPoint[]> {
  const key = `${coingeckoId}:${days}`;
  const hit = historyCache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < HISTORY_TTL) return hit.data;
  try {
    const data = (await cgFetch(
      `/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`
    )) as { prices?: [number, number][] };
    const points: SeriesPoint[] = (data.prices ?? []).filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
    if (points.length >= 2) {
      historyCache.set(key, { data: points, ts: now });
      return points;
    }
    return hit?.data ?? [];
  } catch {
    return hit?.data ?? []; // stale beats nothing; empty means "no chart"
  }
}

// ---------- per-token deep detail (Jupiter token search) ----------

export type TokenDetail = {
  symbol: string | null;
  name: string | null;
  holderCount: number | null;
  organicScore: number | null;
  topHoldersPct: number | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  buys24h: number | null;
  sells24h: number | null;
  traders24h: number | null;
  createdAt: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mbDetailCache: Map<string, CacheEntry<TokenDetail>> | undefined;
}
const detailCache = (globalThis.__mbDetailCache ??= new Map());
const DETAIL_TTL = 5 * 60_000;

export async function getTokenDetail(mint: string): Promise<TokenDetail | null> {
  const hit = detailCache.get(mint);
  if (hit && Date.now() - hit.ts < DETAIL_TTL) return hit.data;
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`jupiter ${res.status}`);
    const list = (await res.json()) as Array<{
      id: string;
      symbol?: string;
      name?: string;
      holderCount?: number;
      organicScore?: number;
      firstPool?: { createdAt?: string };
      audit?: {
        mintAuthorityDisabled?: boolean;
        freezeAuthorityDisabled?: boolean;
        topHoldersPercentage?: number;
      };
      stats24h?: { numBuys?: number; numSells?: number; numTraders?: number };
    }>;
    const t = list?.find((x) => x.id === mint);
    if (!t) return hit?.data ?? null;
    const detail: TokenDetail = {
      symbol: t.symbol ?? null,
      name: t.name ?? null,
      holderCount: t.holderCount ?? null,
      organicScore: t.organicScore != null ? Math.round(t.organicScore) : null,
      topHoldersPct: t.audit?.topHoldersPercentage ?? null,
      mintAuthorityDisabled: t.audit?.mintAuthorityDisabled ?? null,
      freezeAuthorityDisabled: t.audit?.freezeAuthorityDisabled ?? null,
      buys24h: t.stats24h?.numBuys ?? null,
      sells24h: t.stats24h?.numSells ?? null,
      traders24h: t.stats24h?.numTraders ?? null,
      createdAt: t.firstPool?.createdAt ?? null,
    };
    detailCache.set(mint, { data: detail, ts: Date.now() });
    return detail;
  } catch {
    return hit?.data ?? null;
  }
}

const MARKETS_TTL = 15 * 60_000;

/**
 * One batched CoinGecko /coins/markets call for the whole curated universe:
 * price, mcap, volume, 24h/7d change and a real 7-day sparkline per token.
 */
export async function getMarketsOverview(cgIds: string[]): Promise<Record<string, MarketOverview>> {
  // Cache PER id-set — a single global entry would let a one-token call from a
  // token page overwrite (and then serve) the whole markets table.
  // (instanceof guard: a hot-reloaded process may still hold the old
  // pre-Map shape of this global)
  let cacheMap = globalThis.__mbMarketsCache;
  if (!(cacheMap instanceof Map)) cacheMap = globalThis.__mbMarketsCache = new Map();
  const cacheKey = [...cgIds].sort().join(",");
  const cached = cacheMap.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < MARKETS_TTL) return cached.data;
  try {
    const data = (await cgFetch(
      `/coins/markets?vs_currency=usd&ids=${cgIds.join(",")}&sparkline=true&price_change_percentage=24h,7d&per_page=${cgIds.length}`
    )) as Array<{
      id: string;
      current_price?: number;
      market_cap?: number;
      total_volume?: number;
      price_change_percentage_24h_in_currency?: number;
      price_change_percentage_7d_in_currency?: number;
      sparkline_in_7d?: { price?: number[] };
    }>;
    const out: Record<string, MarketOverview> = {};
    for (const row of data ?? []) {
      out[row.id] = {
        cgId: row.id,
        price: row.current_price ?? null,
        mcap: row.market_cap ?? null,
        volume24h: row.total_volume ?? null,
        change24h: row.price_change_percentage_24h_in_currency ?? null,
        change7d: row.price_change_percentage_7d_in_currency ?? null,
        sparkline7d: row.sparkline_in_7d?.price ?? [],
      };
    }
    if (Object.keys(out).length > 0) {
      cacheMap.set(cacheKey, { data: out, ts: now });
      return out;
    }
    return cached?.data ?? {};
  } catch {
    return cached?.data ?? {};
  }
}

function priceAt(series: SeriesPoint[], ts: number): number {
  // binary search nearest point
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] < ts) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(series[lo - 1][0] - ts) < Math.abs(series[lo][0] - ts)) lo -= 1;
  return series[lo][1];
}

const MINT_HISTORY_TTL = 10 * 60_000;

/**
 * Price history for a mint with no CoinGecko id: GeckoTerminal candle closes
 * from the token's top pool. This is what lets a basket of arbitrary tokens
 * still draw a performance chart.
 */
async function getMintHistory(mint: string, days: number): Promise<SeriesPoint[]> {
  const key = `${mint}:${days}`;
  const hit = mintHistoryCache.get(key);
  if (hit && Date.now() - hit.ts < MINT_HISTORY_TTL) return hit.data;
  const { getCandles } = await import("./gecko");
  const frame = days <= 1 ? "15m" : days <= 7 ? "1h" : days <= 60 ? "4h" : "1d";
  const limit = days <= 1 ? 96 : days <= 7 ? 24 * days : days <= 60 ? 6 * days : days;
  const candles = await getCandles(mint, frame, Math.min(limit, 1000));
  const cutoff = Date.now() - days * 86_400_000;
  const points: SeriesPoint[] = candles
    .map((c): SeriesPoint => [c.t * 1000, c.c])
    .filter((p) => p[0] >= cutoff && p[1] > 0);
  if (points.length >= 2) mintHistoryCache.set(key, { data: points, ts: Date.now() });
  return points;
}

/**
 * Weighted index of a coin basket, normalized to 100 at window start.
 * History comes from CoinGecko for curated tokens and GeckoTerminal candles
 * for everything else, so custom baskets chart too; weights renormalize and
 * `coverage` reports how much of the basket the chart actually represents.
 */
export async function getBasketIndex(
  tokens: { mint: string; weight: number }[],
  days: number
): Promise<{ points: SeriesPoint[]; coverage: number }> {
  const members = tokens.map((t) => ({
    ...t,
    cgId: TOKENS_BY_MINT[t.mint]?.coingeckoId ?? null,
  }));

  const series = await Promise.all(
    members.map((m) => (m.cgId != null ? getHistory(m.cgId, days) : getMintHistory(m.mint, days)))
  );
  const included = members
    .map((m, i) => ({ weight: m.weight, series: series[i] }))
    .filter((m) => m.series.length >= 2);

  if (included.length === 0) return { points: [], coverage: 0 };

  const coverage = included.reduce((s, m) => s + m.weight, 0);
  const start = Math.max(...included.map((m) => m.series[0][0]));
  const end = Math.min(...included.map((m) => m.series[m.series.length - 1][0]));
  if (end <= start) return { points: [], coverage: 0 };

  const reference = included.reduce((a, b) => (a.series.length >= b.series.length ? a : b));
  const timeline = reference.series.map((p) => p[0]).filter((ts) => ts >= start && ts <= end);
  if (timeline.length < 2) return { points: [], coverage: 0 };

  const t0 = timeline[0];
  const points: SeriesPoint[] = timeline.map((ts) => {
    let value = 0;
    for (const m of included) {
      const base = priceAt(m.series, t0);
      if (base > 0) value += (m.weight / coverage) * (priceAt(m.series, ts) / base);
    }
    return [ts, value * 100];
  });
  return { points, coverage };
}
