// GeckoTerminal — free, keyless OHLCV candles per token (30 req/min).
// Pool discovery is cached hard; candle sets are cached per (pool, frame).

export type Candle = {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type CandleFrame = "15m" | "1h" | "4h" | "1d";

const FRAME_PATH: Record<CandleFrame, { path: string; aggregate: number }> = {
  "15m": { path: "minute", aggregate: 15 },
  "1h": { path: "hour", aggregate: 1 },
  "4h": { path: "hour", aggregate: 4 },
  "1d": { path: "day", aggregate: 1 },
};

type CacheEntry<T> = { data: T; ts: number };
declare global {
  // eslint-disable-next-line no-var
  var __bPoolCache: Map<string, CacheEntry<string | null>> | undefined;
  // eslint-disable-next-line no-var
  var __bCandleCache: Map<string, CacheEntry<Candle[]>> | undefined;
  // eslint-disable-next-line no-var
  var __bGeckoQueue: Promise<unknown> | undefined;
}
const poolCache = (globalThis.__bPoolCache ??= new Map());
const candleCache = (globalThis.__bCandleCache ??= new Map());

const POOL_TTL = 6 * 60 * 60_000;
const CANDLE_TTL = 60_000;

/** Serialize GeckoTerminal calls with a gap — 30 req/min limit. */
function geckoFetch(url: string): Promise<unknown> {
  const queue = globalThis.__bGeckoQueue ?? Promise.resolve();
  const run = queue.then(async () => {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
    return res.json();
  });
  globalThis.__bGeckoQueue = run.then(
    () => new Promise((r) => setTimeout(r, 2100)),
    () => new Promise((r) => setTimeout(r, 2100))
  );
  return run;
}

/** Highest-liquidity pool address for a mint. */
async function getTopPool(mint: string): Promise<string | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.ts < POOL_TTL) return hit.data;
  try {
    const data = (await geckoFetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`
    )) as {
      data?: Array<{
        id?: string;
        attributes?: { reserve_in_usd?: string };
      }>;
    };
    const pools = (data.data ?? [])
      .map((p) => ({
        // id is "solana_<pooladdress>"
        address: p.id?.replace(/^solana_/, "") ?? null,
        reserve: Number(p.attributes?.reserve_in_usd ?? 0),
      }))
      .filter((p): p is { address: string; reserve: number } => p.address != null);
    pools.sort((a, b) => b.reserve - a.reserve);
    const best = pools[0]?.address ?? null;
    poolCache.set(mint, { data: best, ts: Date.now() });
    return best;
  } catch {
    return hit?.data ?? null;
  }
}

/** Real OHLCV candles for a token's top pool. Empty array = unavailable. */
export async function getCandles(mint: string, frame: CandleFrame, limit = 200): Promise<Candle[]> {
  const pool = await getTopPool(mint);
  if (!pool) return [];
  const key = `${pool}:${frame}:${limit}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.ts < CANDLE_TTL) return hit.data;
  const { path, aggregate } = FRAME_PATH[frame];
  try {
    const data = (await geckoFetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${path}?aggregate=${aggregate}&limit=${limit}&currency=usd`
    )) as { data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } } };
    const list = data.data?.attributes?.ohlcv_list ?? [];
    const candles: Candle[] = list
      .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
      .filter((c) => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
      .sort((a, b) => a.t - b.t);
    if (candles.length > 0) candleCache.set(key, { data: candles, ts: Date.now() });
    return candles.length > 0 ? candles : (hit?.data ?? []);
  } catch {
    return hit?.data ?? [];
  }
}
