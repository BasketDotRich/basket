// Squad mirroring as a STANDING ALLOCATION, not a one-shot purchase.
//
// The model: you pledge an amount of SOL to follow a squad. That pledge sits
// as SOL in your own wallet until the squad is actually holding something.
// When they enter, your allocation follows them in — weighted by member and
// position size. When they exit, it comes back out to SOL and waits.
//
// This is why you no longer have to time your deposit. Funding a squad while
// they are 100% in cash is the NORMAL case, not an error: you are funding the
// strategy, and the engine runs it. The old design refused that deposit and
// told people to come back later, which is backwards — the whole point of
// copy-trading is that you are not the one watching.
import { getDb } from "./db";
import { getPrices } from "./prices";
import { getSquadPortfolio, squadIsMirrorable } from "./squad";

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Don't churn the wallet over rounding: only trade a leg this far off target. */
const REBALANCE_TOLERANCE = 0.15; // 15% of the leg's target
/** Below this a corrective swap costs more than the drift it fixes. */
const MIN_TRADE_LAMPORTS = 8_000_000; // ~0.008 SOL

export type MirrorResult = {
  basketId: number;
  deployed: number;   // lamports now in positions
  idle: number;       // lamports of the allocation still sitting in SOL
  buys: number;
  sells: number;
  skipped: string | null;
};

export function getAllocation(userId: number, basketId: number): number {
  const row = getDb()
    .prepare("SELECT allocated_lamports FROM trader_holdings WHERE user_id = ? AND basket_id = ?")
    .get(userId, basketId) as { allocated_lamports: number } | undefined;
  return row?.allocated_lamports ?? 0;
}

/** Add to (or reduce) a standing squad allocation. Never trades by itself. */
export function setAllocation(userId: number, basketId: number, lamports: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO trader_holdings (user_id, basket_id, units, cost, allocated_lamports)
     VALUES (?, ?, 0, 0, ?)
     ON CONFLICT(user_id, basket_id) DO UPDATE SET allocated_lamports = ?`
  ).run(userId, basketId, Math.max(0, lamports), Math.max(0, lamports));
}

/**
 * Bring one user's mirror of one squad in line with what that squad holds now.
 *
 * Idempotent and self-correcting: it compares target against actual and trades
 * only the difference, so running it twice is harmless and a missed webhook
 * just means the next run catches up.
 */
/**
 * Non-blocking (user, basket) mutex, shared by the mirror engine AND by
 * invest/redeem. It has to be shared: invest writes the full pledge before it
 * buys anything, so a sync landing in that window sees "full allocation, zero
 * holdings" and deploys the same money a second time.
 */
export async function withMirrorLock<T>(
  userId: number,
  basketId: number,
  fn: () => Promise<T>,
  onBusy: () => T
): Promise<T> {
  const lockKey = `${userId}:${basketId}`;
  const locks = (globalThis.__bMirrorLocks ??= new Set<string>());
  if (locks.has(lockKey)) return onBusy();
  locks.add(lockKey);
  try {
    return await fn();
  } finally {
    locks.delete(lockKey);
  }
}

export async function syncSquadMirror(
  userId: number,
  basketId: number
): Promise<MirrorResult> {
  return withMirrorLock(
    userId,
    basketId,
    () => syncSquadMirrorInner(userId, basketId),
    () => ({ basketId, deployed: 0, idle: 0, buys: 0, sells: 0, skipped: "sync already running" })
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __bMirrorLocks: Set<string> | undefined;
}

async function syncSquadMirrorInner(
  userId: number,
  basketId: number
): Promise<MirrorResult> {
  const db = getDb();
  const allocated = getAllocation(userId, basketId);
  const base: MirrorResult = { basketId, deployed: 0, idle: allocated, buys: 0, sells: 0, skipped: null };
  if (allocated <= 0) return { ...base, skipped: "no allocation" };

  const squad = await getSquadPortfolio(basketId);
  const check = squadIsMirrorable(squad);
  if (!check.ok) {
    // Coverage problems mean we cannot compute correct weights. Holding
    // position beats trading on a guess — try again next tick.
    return { ...base, skipped: check.reason ?? "squad not readable" };
  }

  // What the allocation SHOULD look like right now.
  const deployTarget = Math.floor(allocated * squad.deployPct);
  const targetByMint = new Map<string, number>();
  for (const leg of squad.legs) {
    targetByMint.set(leg.mint, Math.floor(deployTarget * leg.weight));
  }

  // What it actually looks like, valued in lamports.
  const rows = db
    .prepare("SELECT mint, qty FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0")
    .all(userId, basketId) as { mint: string; qty: number }[];

  const mints = [...new Set([...targetByMint.keys(), ...rows.map((r) => r.mint)])];
  if (mints.length === 0) return { ...base, skipped: "nothing to mirror yet" };

  const prices = await getPrices(mints);
  const solPrice = prices["So11111111111111111111111111111111111111112"]?.usdPrice ?? 0;
  const { solPriceUsd } = await import("./treasury");
  const sol = solPrice > 0 ? solPrice : ((await solPriceUsd()) ?? 0);
  if (sol <= 0) return { ...base, skipped: "no SOL price" };

  // A leg we cannot price is NOT a leg we do not own. Skipping it here made it
  // read as have=0, so the engine "topped up" a position it already held —
  // every tick, without bound, until the wallet was empty. Any unpriceable
  // holding now aborts the whole sync: we cannot compute correct targets
  // without knowing what we already have.
  const actualByMint = new Map<string, number>();
  const unpriced: string[] = [];
  for (const r of rows) {
    const px = prices[r.mint]?.usdPrice;
    if (px == null || px <= 0) {
      unpriced.push(r.mint);
      continue;
    }
    actualByMint.set(r.mint, Math.floor(((r.qty * px) / sol) * LAMPORTS_PER_SOL));
  }
  if (unpriced.length > 0) {
    return { ...base, skipped: `holding ${unpriced.length} unpriceable leg(s) — cannot value the position` };
  }

  const buys: { mint: string; symbol: string; lamports: number }[] = [];
  const sells: { mint: string; fraction: number }[] = [];
  for (const mint of mints) {
    const want = targetByMint.get(mint) ?? 0;
    const have = actualByMint.get(mint) ?? 0;
    const drift = want - have;
    const scale = Math.max(want, have, 1);
    if (Math.abs(drift) < MIN_TRADE_LAMPORTS) continue;
    if (Math.abs(drift) / scale < REBALANCE_TOLERANCE) continue;
    if (drift > 0) {
      const leg = squad.legs.find((l) => l.mint === mint);
      buys.push({ mint, symbol: leg?.symbol ?? mint.slice(0, 6), lamports: drift });
    } else {
      sells.push({ mint, fraction: Math.min(1, Math.abs(drift) / have) });
    }
  }

  // ---- EXECUTE ----
  // Sells first: they free SOL that the buys may need, and reducing exposure
  // is the safer half to complete if the process dies partway through.
  const { getAccountWallet, getSolBalance, signSendConfirmOne, WITHDRAW_RESERVE_LAMPORTS } =
    await import("./accounts");
  const wallet = getAccountWallet(userId);
  if (!wallet) return { ...base, skipped: "no wallet" };

  const { quoteExitLegs, quoteBasketLegs, buildSwapTransactions } = await import("./swap");
  let sold = 0;
  let bought = 0;

  for (const sell of sells) {
    try {
      const row = rows.find((r) => r.mint === sell.mint);
      if (!row) continue;
      const meta = db
        .prepare("SELECT symbol, decimals FROM token_meta WHERE mint = ?")
        .get(sell.mint) as { symbol: string; decimals: number } | undefined;
      const decimals = meta?.decimals ?? 6;
      const rawAmount = BigInt(Math.floor(row.qty * sell.fraction * 10 ** decimals));
      if (rawAmount <= BigInt(0)) continue;
      const quoted = await quoteExitLegs(
        [{ mint: sell.mint, symbol: meta?.symbol ?? "", rawAmount: rawAmount.toString() }],
        150
      );
      if (quoted.length === 0) continue; // unrouteable leg — leave it, try next tick
      const [tx] = await buildSwapTransactions(quoted, wallet.address);
      const sig = await signSendConfirmOne(userId, tx);
      applyLedgerDelta(db, userId, basketId, sell.mint, -sell.fraction, 0);
      recordMirrorTrade(db, userId, basketId, `Mirror sell ${meta?.symbol ?? sell.mint.slice(0, 6)} · ${sig}`);
      sold++;
    } catch {
      // one leg failing must not stop the rest of the rebalance
    }
  }

  for (const buy of buys) {
    try {
      // Never spend past the allocation, and always leave network-fee headroom.
      const balance = await getSolBalance(wallet.address);
      const spendable = Math.min(buy.lamports, balance - WITHDRAW_RESERVE_LAMPORTS);
      if (spendable < MIN_TRADE_LAMPORTS) continue;
      const legs = await quoteBasketLegs(
        [{ mint: buy.mint, symbol: buy.symbol, weight: 1 }],
        spendable,
        150
      );
      if (legs.length === 0) continue;
      // Resolve decimals BEFORE trading. A mirrored token may be one we have
      // never stored; defaulting to 6 corrupts the recorded quantity by
      // 10^(d-6), and a missing token_meta row makes the position invisible in
      // the portfolio and unsellable on redeem (both JOIN token_meta).
      const decimals = await ensureTokenMeta(db, buy.mint, buy.symbol);
      if (decimals == null) continue; // cannot record it correctly — do not buy it

      const [tx] = await buildSwapTransactions(legs, wallet.address);
      const sig = await signSendConfirmOne(userId, tx);
      const qty = Number(legs[0].outAmount) / 10 ** decimals;
      const costUsd = (legs[0].lamportsIn / LAMPORTS_PER_SOL) * sol;
      addLedgerPosition(db, userId, basketId, buy.mint, qty, costUsd);
      recordMirrorTrade(db, userId, basketId, `Mirror buy ${buy.symbol} · ${sig}`);
      bought++;
    } catch {
      // same: a failed leg is retried on the next sync, not fatal
    }
  }

  const deployedNow = [...actualByMint.values()].reduce((a, b) => a + b, 0);
  return {
    basketId,
    deployed: deployedNow,
    idle: Math.max(0, allocated - deployedNow),
    buys: bought,
    sells: sold,
    skipped: null,
  };
}

/**
 * Make sure a mirrored mint exists in token_meta, returning its real decimals.
 * Returns null when the token cannot be resolved — the caller must then skip
 * it rather than record a position it cannot value or sell.
 */
async function ensureTokenMeta(
  db: ReturnType<typeof getDb>,
  mint: string,
  symbol: string
): Promise<number | null> {
  const existing = db
    .prepare("SELECT decimals FROM token_meta WHERE mint = ?")
    .get(mint) as { decimals: number } | undefined;
  if (existing) return existing.decimals;
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ id: string; symbol?: string; name?: string; decimals?: number }>;
    const t = list?.find((x) => x.id === mint);
    if (!t || t.decimals == null) return null;
    db.prepare(
      "INSERT OR IGNORE INTO token_meta (mint, symbol, name, icon, decimals, coingecko_id, tracked) VALUES (?, ?, ?, ?, ?, NULL, 0)"
    ).run(
      mint,
      (t.symbol ?? symbol).trim(),
      (t.name ?? symbol).trim(),
      `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png?size=lg`,
      t.decimals
    );
    return t.decimals;
  } catch {
    return null;
  }
}

/** Scale one ledger leg by (1 + delta); delta -1 removes it entirely. */
function applyLedgerDelta(
  db: ReturnType<typeof getDb>,
  userId: number,
  basketId: number,
  mint: string,
  delta: number,
  _unused: number
): void {
  const keep = 1 + delta;
  if (keep <= 0.0001) {
    db.prepare("DELETE FROM holdings WHERE user_id = ? AND basket_id = ? AND mint = ?").run(
      userId, basketId, mint
    );
    return;
  }
  db.prepare(
    "UPDATE holdings SET qty = qty * ?, cost = cost * ? WHERE user_id = ? AND basket_id = ? AND mint = ?"
  ).run(keep, keep, userId, basketId, mint);
}

function addLedgerPosition(
  db: ReturnType<typeof getDb>,
  userId: number,
  basketId: number,
  mint: string,
  qty: number,
  cost: number
): void {
  db.prepare(
    `INSERT INTO holdings (user_id, basket_id, mint, qty, cost) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, basket_id, mint) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost`
  ).run(userId, basketId, mint, qty, cost);
}

function recordMirrorTrade(
  db: ReturnType<typeof getDb>,
  userId: number,
  basketId: number,
  detail: string
): void {
  db.prepare(
    "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'trade', ?, 0, ?, ?)"
  ).run(userId, basketId, detail, Date.now());
}

/** Every (user, basket) pair with a standing allocation — the sync work list. */
export function activeAllocations(): { user_id: number; basket_id: number }[] {
  return getDb()
    .prepare(
      "SELECT user_id, basket_id FROM trader_holdings WHERE allocated_lamports > 0"
    )
    .all() as { user_id: number; basket_id: number }[];
}
