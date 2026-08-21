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
export async function syncSquadMirror(
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

  const actualByMint = new Map<string, number>();
  for (const r of rows) {
    const px = prices[r.mint]?.usdPrice;
    if (px == null || px <= 0) continue; // unpriceable leg: leave it alone
    actualByMint.set(r.mint, Math.floor(((r.qty * px) / sol) * LAMPORTS_PER_SOL));
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

  const deployedNow = [...actualByMint.values()].reduce((a, b) => a + b, 0);
  return {
    basketId,
    deployed: deployedNow,
    idle: Math.max(0, allocated - deployedNow),
    buys: buys.length,
    sells: sells.length,
    skipped: null,
  };
}

/** Every (user, basket) pair with a standing allocation — the sync work list. */
export function activeAllocations(): { user_id: number; basket_id: number }[] {
  return getDb()
    .prepare(
      "SELECT user_id, basket_id FROM trader_holdings WHERE allocated_lamports > 0"
    )
    .all() as { user_id: number; basket_id: number }[];
}
