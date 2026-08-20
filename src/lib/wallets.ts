// Real on-chain wallet tracking (no API keys).
//
// Methodology — stated in the UI: a wallet's tracked value is
//   SOL + stablecoins + positions in the tracked token universe
// where the universe = our token_meta table ∪ Jupiter's top-organic-score
// tokens (refreshed hourly). Spam airdrops (thousands per famous wallet)
// are excluded because they are not in the universe and mostly unpriceable.
//
// Data sources, all keyless:
//   balances:  lite-api.jup.ag/ultra/v1/balances/{wallet}   (1 call/wallet)
//   prices:    lite-api.jup.ag/price/v3?ids=...             (batched)
//   universe:  lite-api.jup.ag/tokens/v2/toporganicscore    (cached 1h)
//
// Equity curves are built from snapshots persisted in SQLite from the moment
// a wallet is added — real history accumulates while the app runs; there is
// no fabricated backfill.
import { getDb } from "./db";
import { getPrices, type SeriesPoint } from "./prices";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

type UniverseCache = { mints: Map<string, string>; ts: number }; // mint → symbol
type BalancesCache = { data: Record<string, number>; sol: number; ts: number };
type ValueCache = { value: WalletValue; ts: number };

declare global {
  // eslint-disable-next-line no-var
  var __bUniverseV2: UniverseCache | undefined;
  // When each mint entered the universe. 0 = "before we were watching"
  // (everything seeded on the first build of a process). Lets the snapshot
  // diff tell "we started tracking this mint" apart from "the wallet bought".
  // eslint-disable-next-line no-var
  var __bUniverseAddedAt: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __bBalances: Map<string, BalancesCache> | undefined;
  // eslint-disable-next-line no-var
  var __bWalletValues: Map<string, ValueCache> | undefined;
  // eslint-disable-next-line no-var
  var __bRefresher: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __bRefresherBusy: boolean | undefined;
}

const balancesCache = (globalThis.__bBalances ??= new Map());
const valueCache = (globalThis.__bWalletValues ??= new Map());

const UNIVERSE_TTL = 60 * 60_000;
const BALANCES_TTL = 4 * 60_000;
const VALUE_TTL = 4 * 60_000;
const SNAPSHOT_GAP = 5 * 60_000;
// Beyond this the previous snapshot is too old to stamp a detected change with
// "now" — the diff is skipped (the snapshot itself is still written).
const MAX_DIFF_WINDOW = 30 * 60_000;

/**
 * Tracked token universe: token_meta (tracked rows only) ∪ Jupiter top organic,
 * mint → symbol. MONOTONIC within a process: a mint that has entered the
 * universe never leaves it, so an hourly refresh can't make a held position
 * vanish and look like a sale.
 */
export async function getUniverseMints(): Promise<Map<string, string>> {
  const cached = globalThis.__bUniverseV2;
  if (cached && Date.now() - cached.ts < UNIVERSE_TTL) return cached.mints;

  // First build of this process: everything gets addedAt=0 ("always been
  // tracked") so a restart never marks long-tracked mints as fresh arrivals.
  const firstBuild = cached == null;
  const addedAt = (globalThis.__bUniverseAddedAt ??= new Map());
  const stamp = (mint: string) => {
    if (!addedAt.has(mint)) addedAt.set(mint, firstBuild ? 0 : Date.now());
  };

  // seed from the previous cache — never shrink
  const mints = new Map<string, string>(cached?.mints ?? []);
  mints.set(SOL_MINT, "SOL");
  mints.set(USDC_MINT, "USDC");
  mints.set(USDT_MINT, "USDT");
  const db = getDb();
  // Only curated/tracked rows join the universe. User-added basket tokens live
  // in token_meta as metadata but must not silently widen global NAV tracking.
  for (const row of db.prepare("SELECT mint, symbol FROM token_meta WHERE tracked = 1").all() as {
    mint: string;
    symbol: string;
  }[]) {
    mints.set(row.mint, row.symbol);
  }
  await Promise.all(
    ["1h", "24h"].map(async (interval) => {
      try {
        const res = await fetch(
          `https://lite-api.jup.ag/tokens/v2/toporganicscore/${interval}?limit=100`,
          { signal: AbortSignal.timeout(10_000), cache: "no-store" }
        );
        if (!res.ok) return;
        const list = (await res.json()) as Array<{ id: string; symbol?: string }>;
        for (const t of list ?? []) {
          if (!mints.has(t.id)) mints.set(t.id, t.symbol ?? "");
        }
      } catch {
        // universe just stays smaller this cycle
      }
    })
  );
  for (const mint of mints.keys()) stamp(mint);
  globalThis.__bUniverseV2 = { mints, ts: Date.now() };
  return mints;
}

/** When a mint joined the tracked universe (0 = before this process started). */
function universeAddedAt(mint: string): number {
  return globalThis.__bUniverseAddedAt?.get(mint) ?? 0;
}

/** Best-effort symbol for a mint from the cached universe. */
export function mintSymbol(mint: string): string {
  const sym = globalThis.__bUniverseV2?.mints.get(mint);
  return sym || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** Non-frozen token balances of a wallet: mint → uiAmount, plus SOL. */
async function getBalances(wallet: string): Promise<{ tokens: Record<string, number>; sol: number } | null> {
  const cached = balancesCache.get(wallet);
  if (cached && Date.now() - cached.ts < BALANCES_TTL) {
    return { tokens: cached.data, sol: cached.sol };
  }
  try {
    const res = await fetch(`https://lite-api.jup.ag/ultra/v1/balances/${wallet}`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`balances ${res.status}`);
    const data = (await res.json()) as Record<
      string,
      { uiAmount?: number; isFrozen?: boolean }
    >;
    const tokens: Record<string, number> = {};
    let sol = 0;
    for (const [key, v] of Object.entries(data)) {
      if (key === "SOL") {
        sol = v.uiAmount ?? 0;
      } else if (!v.isFrozen && (v.uiAmount ?? 0) > 0) {
        tokens[key] = v.uiAmount!;
      }
    }
    balancesCache.set(wallet, { data: tokens, sol, ts: Date.now() });
    return { tokens, sol };
  } catch {
    return cached ? { tokens: cached.data, sol: cached.sol } : null;
  }
}

export type WalletHolding = { mint: string; symbol?: string; amount: number; valueUsd: number };
export type WalletValue = {
  totalUsd: number;
  solAmount: number;
  solUsd: number;
  holdings: WalletHolding[]; // priced tracked tokens, value desc (consumers slice)
  /**
   * Raw on-chain quantities for every universe mint the wallet touches, with
   * the price used. This — not `holdings` — is the diff basis for trade
   * detection: it is independent of price, USD rank and dust thresholds, so a
   * pump or a rank shuffle can never look like a buy or a sale.
   */
  trackedAmounts: [mint: string, amount: number, price: number][];
  asOf: number;
};

/** Cache-only read — instant, for fast page paints. Null until the refresher warms it. */
export function getWalletValueCached(wallet: string): WalletValue | null {
  return valueCache.get(wallet)?.value ?? null;
}

/** Tracked USD value of a wallet right now. Null only if balances unreachable. */
export async function getWalletValue(wallet: string): Promise<WalletValue | null> {
  const cached = valueCache.get(wallet);
  if (cached && Date.now() - cached.ts < VALUE_TTL) return cached.value;

  const balances = await getBalances(wallet);
  if (!balances) return cached?.value ?? null;

  const universe = await getUniverseMints();
  const tracked = Object.keys(balances.tokens).filter((m) => universe.has(m));
  const prices = await getPrices([SOL_MINT, ...tracked]);

  const solPrice = prices[SOL_MINT]?.usdPrice ?? 0;
  // An incomplete pricing pass would record an undervalued snapshot and poison
  // the equity curve — treat it as a failure instead.
  if (solPrice <= 0) return cached?.value ?? null;
  if (tracked.length >= 5) {
    const resolved = tracked.filter((m) => (prices[m]?.usdPrice ?? 0) > 0).length;
    if (resolved < tracked.length * 0.5) return cached?.value ?? null;
  }
  const holdings: WalletHolding[] = [];
  const trackedAmounts: [string, number, number][] = [];
  let total = balances.sol * solPrice;
  for (const mint of tracked) {
    const amount = balances.tokens[mint];
    const p = prices[mint]?.usdPrice ?? 0;
    // raw quantity is recorded whether or not it is priceable — the diff needs
    // "held but unpriced" to be distinguishable from "not held"
    trackedAmounts.push([mint, amount, p]);
    if (p <= 0) continue;
    const valueUsd = amount * p;
    if (valueUsd < 1) continue; // dust: excluded from VALUE, still in trackedAmounts
    holdings.push({ mint, amount, valueUsd });
    total += valueUsd;
  }
  holdings.sort((a, b) => b.valueUsd - a.valueUsd);

  const value: WalletValue = {
    totalUsd: total,
    solAmount: balances.sol,
    solUsd: balances.sol * solPrice,
    holdings,
    trackedAmounts,
    asOf: Date.now(),
  };
  valueCache.set(wallet, { value, ts: Date.now() });
  return value;
}

/**
 * Persist a snapshot for a trader if the last one is old enough, and diff the
 * held positions against the previous snapshot to record detected buys/sells.
 */
export async function snapshotTrader(traderId: number, wallet: string): Promise<WalletValue | null> {
  const db = getDb();
  const value = await getWalletValue(wallet);
  if (!value) return null;
  const last = db
    .prepare("SELECT ts, holdings FROM wallet_snapshots WHERE trader_id = ? ORDER BY ts DESC LIMIT 1")
    .get(traderId) as { ts: number; holdings: string | null } | undefined;
  if (!last || Date.now() - last.ts >= SNAPSHOT_GAP) {
    const now = Date.now();
    const stale = last != null && now - last.ts > MAX_DIFF_WINDOW;
    if (last?.holdings && !stale) {
      try {
        const prev = JSON.parse(last.holdings) as [string, number, number][];
        // Diff RAW QUANTITIES from the same universe-filtered source on both
        // sides. Price moves, rank churn and dust thresholds cannot reach this.
        if (Array.isArray(prev) && prev.every((p) => Array.isArray(p) && p.length === 3)) {
          const prevAmt = new Map(prev.map(([m, a]) => [m, a]));
          const prevPrice = new Map(prev.map(([m, , p]) => [m, p]));
          const curAmt = new Map(value.trackedAmounts.map(([m, a]) => [m, a]));
          const curPrice = new Map(value.trackedAmounts.map(([m, , p]) => [m, p]));
          // USD that appeared only because the universe started tracking a
          // mint the wallet already held — bookkeeping, not trading.
          let bookkeepingUsd = 0;
          for (const mint of new Set([...prevAmt.keys(), ...curAmt.keys()])) {
            if (mint === SOL_MINT) continue;
            // A mint absent from ONE side was not observed, not necessarily
            // untraded — only diff mints present on both sides, plus genuine
            // first-appearances (absent before, present now, non-zero).
            const seenBefore = prevAmt.has(mint);
            const seenNow = curAmt.has(mint);
            if (!seenBefore && !seenNow) continue;
            if (seenBefore !== seenNow) {
              // one-sided: only trust a NEW position appearing, never a
              // disappearance (which is usually an observability gap)
              if (!seenNow) continue;
              // ...and only when the mint was already tracked when the last
              // snapshot was taken. If it joined the universe afterwards, the
              // wallet may have held it for months — recording a "buy" would
              // fabricate a trade out of our own bookkeeping.
              if (universeAddedAt(mint) > last.ts) {
                bookkeepingUsd += (curAmt.get(mint) ?? 0) * (curPrice.get(mint) ?? 0);
                continue;
              }
            }
            const before = prevAmt.get(mint) ?? 0;
            const after = curAmt.get(mint) ?? 0;
            const dAmt = after - before;
            if (dAmt === 0) continue;
            const rel = Math.abs(dAmt) / Math.max(before, after, 1e-12);
            if (rel < 0.25) continue; // ≥25% quantity change
            const price = curPrice.get(mint) || prevPrice.get(mint) || 0;
            const deltaUsd = dAmt * price;
            if (Math.abs(deltaUsd) < 250) continue; // ≥$250 notional
            db.prepare(
              "INSERT INTO wallet_events (trader_id, ts, mint, symbol, delta_usd, kind) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(traderId, now, mint, mintSymbol(mint), deltaUsd, dAmt > 0 ? "buy" : "sell");
          }
          // The same bookkeeping jump inflates NAV growth (current/baseline).
          // Scale baselines up by the coverage jump so a wider lens doesn't
          // read as trading performance.
          if (bookkeepingUsd > 0 && value.totalUsd > bookkeepingUsd) {
            const factor = value.totalUsd / (value.totalUsd - bookkeepingUsd);
            db.prepare(
              `UPDATE basket_traders SET baseline_value = baseline_value * ?
               WHERE trader_id = ? AND baseline_value IS NOT NULL`
            ).run(factor, traderId);
          }
        }
      } catch {
        // unparseable prior holdings — skip diffing this round
      }
    }
    db.prepare(
      "INSERT INTO wallet_snapshots (trader_id, ts, value, sol, holdings) VALUES (?, ?, ?, ?, ?)"
    ).run(traderId, now, value.totalUsd, value.solAmount, JSON.stringify(value.trackedAmounts));
  }
  return value;
}

/** Keep the append-only tracking tables bounded (runs once per refresher sweep). */
function pruneTrackingTables(): void {
  const db = getDb();
  const cutoff = Date.now() - 45 * 86_400_000;
  db.prepare("DELETE FROM wallet_snapshots WHERE ts < ?").run(cutoff);
  db.prepare(
    "DELETE FROM wallet_events WHERE id NOT IN (SELECT id FROM wallet_events ORDER BY ts DESC LIMIT 2000)"
  ).run();
}

export function getTraderSnapshots(traderId: number, sinceTs = 0): SeriesPoint[] {
  const db = getDb();
  // newest 5000 in the window, then back to ascending for charting
  const rows = db
    .prepare("SELECT ts, value FROM wallet_snapshots WHERE trader_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 5000")
    .all(traderId, sinceTs) as { ts: number; value: number }[];
  return rows.reverse().map((r) => [r.ts, r.value]);
}

/** Live return over a trailing window from real snapshots; null until enough history. */
export function getTraderReturn(traderId: number, windowMs: number): number | null {
  const db = getDb();
  const now = Date.now();
  const past = db
    .prepare(
      "SELECT value FROM wallet_snapshots WHERE trader_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1"
    )
    .get(traderId, now - windowMs) as { value: number } | undefined;
  const latest = db
    .prepare("SELECT value FROM wallet_snapshots WHERE trader_id = ? ORDER BY ts DESC LIMIT 1")
    .get(traderId) as { value: number } | undefined;
  if (!past || !latest || past.value <= 0) return null;
  return (latest.value / past.value - 1) * 100;
}

// ---------- trader-basket NAV on real curves ----------

export type BasketMemberRow = {
  trader_id: number;
  wallet: string;
  weight: number;
  baseline_value: number | null;
};

/**
 * NAV starts at 100 when the basket is created. Each member contributes its
 * wallet's real growth since its baseline (first observed value after basket
 * creation). If live data is unreachable it falls back to the member's last
 * persisted snapshot; a baselined member with no data at all makes the NAV
 * incomplete — with `strict` that throws instead of silently pricing flat.
 */
export async function getTraderBasketNavLive(
  basketId: number,
  opts: { strict?: boolean } = {}
): Promise<number> {
  const db = getDb();
  const members = db
    .prepare(
      `SELECT bt.trader_id, bt.weight, bt.baseline_value, t.wallet
       FROM basket_traders bt JOIN traders t ON t.id = bt.trader_id
       WHERE bt.basket_id = ?`
    )
    .all(basketId) as BasketMemberRow[];
  if (members.length === 0) return 100;

  const totalW = members.reduce((s, m) => s + m.weight, 0) || 1;
  let nav = 0;
  let complete = true;
  // one live fetch per member, concurrently — a 10-member basket must not
  // serialize 10 network round-trips
  const values = await Promise.all(members.map((m) => snapshotTrader(m.trader_id, m.wallet)));
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const value = values[i];
    let current = value && value.totalUsd > 0 ? value.totalUsd : null;
    if (current == null) {
      const last = db
        .prepare("SELECT value FROM wallet_snapshots WHERE trader_id = ? ORDER BY ts DESC LIMIT 1")
        .get(m.trader_id) as { value: number } | undefined;
      if (last && last.value > 0) current = last.value;
    }
    let growth = 1;
    if (current != null) {
      if (m.baseline_value == null) {
        db.prepare(
          "UPDATE basket_traders SET baseline_value = ? WHERE basket_id = ? AND trader_id = ?"
        ).run(current, basketId, m.trader_id);
      } else if (m.baseline_value > 0) {
        growth = current / m.baseline_value;
      }
    } else if (m.baseline_value != null) {
      complete = false; // baselined member with zero data — flat 1.0× would misprice
    }
    nav += (m.weight / totalW) * growth;
  }
  if (opts.strict && !complete) {
    throw new Error("NAV incomplete: wallet data unavailable for a baselined member");
  }
  return nav * 100;
}

/** NAV curve from real snapshots, indexed to 100 at window start. */
export function getTraderBasketCurveLive(basketId: number, days: number): SeriesPoint[] {
  const db = getDb();
  const members = db
    .prepare(
      `SELECT bt.trader_id, bt.weight FROM basket_traders bt WHERE bt.basket_id = ?`
    )
    .all(basketId) as { trader_id: number; weight: number }[];
  if (members.length === 0) return [];

  const since = Date.now() - days * 24 * 3600_000;
  const series = members.map((m) => ({
    weight: m.weight,
    points: getTraderSnapshots(m.trader_id, since),
  }));
  const usable = series.filter((s) => s.points.length >= 2);
  if (usable.length === 0) return [];

  const totalW = usable.reduce((s, m) => s + m.weight, 0) || 1;
  // grid from the series with the most points
  const reference = usable.reduce((a, b) => (a.points.length >= b.points.length ? a : b));
  const start = Math.max(...usable.map((s) => s.points[0][0]));
  const grid = reference.points.map((p) => p[0]).filter((ts) => ts >= start);
  if (grid.length < 2) return [];

  const at = (pts: SeriesPoint[], ts: number): number => {
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] < ts) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(pts[lo - 1][0] - ts) < Math.abs(pts[lo][0] - ts)) lo -= 1;
    return pts[lo][1];
  };

  const t0 = grid[0];
  return grid.map((ts) => {
    let v = 0;
    for (const s of usable) {
      const base = at(s.points, t0);
      if (base > 0) v += (s.weight / totalW) * (at(s.points, ts) / base);
    }
    return [ts, v * 100];
  });
}

/**
 * Background refresher. With a 563-wallet roster we only keep the WARM SET
 * fresh (basket members + leaderboard-ranked wallets, ≤150); directory-only
 * wallets are snapshotted on demand when someone views or adds them.
 * An overlap guard stops sweeps from stacking.
 */
export function ensureWalletRefresher(): void {
  if (globalThis.__bRefresher) return;
  globalThis.__bRefresher = setInterval(async () => {
    if (globalThis.__bRefresherBusy) return;
    globalThis.__bRefresherBusy = true;
    try {
      const db = getDb();
      const traders = db
        .prepare(
          `SELECT DISTINCT t.id, t.wallet FROM traders t
           LEFT JOIN basket_traders bt ON bt.trader_id = t.id
           WHERE bt.trader_id IS NOT NULL OR (t.seed_stats IS NOT NULL AND t.seed_stats LIKE '%monthly%')
           LIMIT 150`
        )
        .all() as { id: number; wallet: string }[];
      for (const t of traders) {
        await snapshotTrader(t.id, t.wallet);
        await new Promise((r) => setTimeout(r, 1500)); // stay polite to lite-api
      }
      pruneTrackingTables();
    } catch {
      // next tick will retry
    } finally {
      globalThis.__bRefresherBusy = false;
    }
  }, SNAPSHOT_GAP);
  globalThis.__bRefresher.unref?.();
}
