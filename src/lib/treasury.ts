// Protocol treasury & buyback-burn accounting.
//
// Three revenue streams, all recorded in treasury_ledger:
//   1. PERFORMANCE FEE — 10% of REALISED PROFIT on every redeem. Charged on
//      gains only: never on principal, never on a loss.
//   2. CREATION FEE — 0.5 SOL per basket created, in SOL terms, converted at
//      the live SOL price for the USD ledger.
//   3. TREASURY PnL — profit the treasury itself earns from deploying stream 1
//      and 2 into baskets. That profit is what gets burned.
//
// Streams 1+2 fund the treasury; the treasury deploys them into baskets; the
// PROFIT from those positions is queued for buyback-and-burn of the platform
// token. Pre-launch there is no platform token and no on-chain execution, so
// this is a faithful ACCRUAL ledger — every number here is what the burn
// engine will execute against at launch. Nothing is presented as an on-chain
// burn that has not happened.
import { getDb } from "./db";
import { getPrices } from "./prices";
import { SOL_MINT } from "./wallets";

export const PERFORMANCE_FEE_BPS = 1000; // 10% of realised profit
export const CREATION_FEE_SOL = 0.5;
export const BURN_SHARE_OF_TREASURY_PNL = 1; // 100% of treasury PnL is burned

export type LedgerKind = "performance_fee" | "creation_fee" | "treasury_pnl" | "deploy" | "burn";

export type LedgerRow = {
  id: number;
  ts: number;
  kind: LedgerKind;
  amount_usd: number;
  amount_sol: number | null;
  user_id: number | null;
  basket_id: number | null;
  detail: string;
};

/** The system user doubles as the treasury account holder. */
export function treasuryUserId(): number {
  const row = getDb()
    .prepare("SELECT id FROM users WHERE email = 'system@basket.rich'")
    .get() as { id: number } | undefined;
  return row?.id ?? 1;
}

export function recordLedger(entry: {
  kind: LedgerKind;
  amountUsd: number;
  amountSol?: number | null;
  userId?: number | null;
  basketId?: number | null;
  detail?: string;
}): void {
  getDb()
    .prepare(
      "INSERT INTO treasury_ledger (ts, kind, amount_usd, amount_sol, user_id, basket_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      Date.now(),
      entry.kind,
      entry.amountUsd,
      entry.amountSol ?? null,
      entry.userId ?? null,
      entry.basketId ?? null,
      entry.detail ?? ""
    );
}

/** Live SOL price for SOL-denominated fees. Null when the feed is unavailable. */
export async function solPriceUsd(): Promise<number | null> {
  const p = await getPrices([SOL_MINT], { maxStaleMs: 5 * 60_000 });
  const v = p[SOL_MINT]?.usdPrice;
  return v && v > 0 ? v : null;
}

/**
 * Performance fee on a realised gain. Returns the fee (0 when the redeem was
 * flat or a loss). Must be called INSIDE the redeem transaction so the fee and
 * the payout can never diverge.
 */
export function takePerformanceFee(args: {
  userId: number;
  basketId: number;
  basketName: string;
  proceeds: number;
  costRedeemed: number;
}): number {
  const profit = args.proceeds - args.costRedeemed;
  if (!(profit > 0)) return 0;
  // The treasury never charges itself a fee — its whole realised profit is the
  // burn, which is the point of deploying fee revenue into baskets.
  if (args.userId === treasuryUserId()) {
    queueBurnFromTreasuryPnl(
      profit,
      `Treasury profit on ${args.basketName} → buyback & burn`
    );
    return 0;
  }
  const fee = (profit * PERFORMANCE_FEE_BPS) / 10_000;
  if (!(fee > 0)) return 0;
  const db = getDb();
  // credit the treasury account so the fee can be deployed like any capital
  db.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").run(fee, treasuryUserId());
  db.prepare(
    "INSERT INTO treasury_ledger (ts, kind, amount_usd, amount_sol, user_id, basket_id, detail) VALUES (?, 'performance_fee', ?, NULL, ?, ?, ?)"
  ).run(
    Date.now(),
    fee,
    args.userId,
    args.basketId,
    `10% of $${profit.toFixed(2)} profit on ${args.basketName}`
  );
  return fee;
}

export class TreasuryError extends Error {}

/**
 * Charge the 0.5 SOL basket-creation fee. Denominated in SOL, settled from the
 * creator's balance at the live SOL price. 100% routes to buyback-and-burn.
 * Throws if the price feed is down (never guess a rate the user pays).
 */
export async function chargeCreationFee(userId: number, basketName: string): Promise<{
  sol: number;
  usd: number;
}> {
  const price = await solPriceUsd();
  if (price == null) {
    throw new TreasuryError("SOL price unavailable — can't price the creation fee right now");
  }
  const usd = CREATION_FEE_SOL * price;
  const db = getDb();
  const r = db
    .prepare("UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ? - 1e-9")
    .run(usd, userId, usd);
  if (r.changes === 0) {
    throw new TreasuryError(
      `Creating a basket costs ${CREATION_FEE_SOL} SOL (≈$${usd.toFixed(2)}) — add funds first`
    );
  }
  db.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").run(usd, treasuryUserId());
  db.prepare(
    "INSERT INTO treasury_ledger (ts, kind, amount_usd, amount_sol, user_id, basket_id, detail) VALUES (?, 'creation_fee', ?, ?, ?, NULL, ?)"
  ).run(Date.now(), usd, CREATION_FEE_SOL, userId, `${CREATION_FEE_SOL} SOL to create "${basketName}"`);
  db.prepare(
    "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'withdraw', NULL, ?, ?, ?)"
  ).run(userId, usd, `Basket creation fee — ${CREATION_FEE_SOL} SOL → buyback & burn`, Date.now());
  return { sol: CREATION_FEE_SOL, usd };
}

/**
 * Book treasury trading profit into the burn queue. Called when the treasury
 * realises a gain on capital it deployed — that profit is what buys back and
 * burns the platform token.
 */
export function queueBurnFromTreasuryPnl(profitUsd: number, detail: string): void {
  if (!(profitUsd > 0)) return;
  const amount = profitUsd * BURN_SHARE_OF_TREASURY_PNL;
  recordLedger({ kind: "treasury_pnl", amountUsd: amount, detail });
}

export type TreasuryStats = {
  performanceFees: number;
  creationFees: number;
  creationFeesSol: number;
  treasuryPnl: number;
  burned: number;
  pendingBurn: number;
  treasuryCash: number;
  deployedValue: number;
  totalInflow: number;
  basketsCreated: number;
};

/** Roll up the ledger plus the treasury's live deployed positions. */
export async function getTreasuryStats(): Promise<TreasuryStats> {
  const db = getDb();
  const sum = (kind: LedgerKind, col: "amount_usd" | "amount_sol" = "amount_usd") =>
    (
      db
        .prepare(`SELECT COALESCE(SUM(${col}), 0) AS v FROM treasury_ledger WHERE kind = ?`)
        .get(kind) as { v: number }
    ).v;

  const performanceFees = sum("performance_fee");
  const creationFees = sum("creation_fee");
  const creationFeesSol = sum("creation_fee", "amount_sol");
  const treasuryPnl = sum("treasury_pnl");
  const burned = Math.abs(sum("burn"));

  const tid = treasuryUserId();
  const treasuryCash = (
    db.prepare("SELECT cash FROM users WHERE id = ?").get(tid) as { cash: number } | undefined
  )?.cash ?? 0;

  // live value of whatever the treasury has deployed into baskets
  const { getPortfolio } = await import("./portfolio");
  let deployedValue = 0;
  try {
    const pf = await getPortfolio(tid);
    deployedValue = pf.totalValue - pf.cash;
  } catch {
    deployedValue = 0;
  }

  const basketsCreated = (
    db.prepare("SELECT COUNT(*) AS n FROM treasury_ledger WHERE kind = 'creation_fee'").get() as {
      n: number;
    }
  ).n;

  return {
    performanceFees,
    creationFees,
    creationFeesSol,
    treasuryPnl,
    burned,
    pendingBurn: Math.max(0, treasuryPnl - burned),
    treasuryCash,
    deployedValue,
    totalInflow: performanceFees + creationFees,
    basketsCreated,
  };
}

const DEPLOY_FLOOR_USD = 100; // keep a working reserve; deploy above this
const DEPLOY_MAX_BASKETS = 3;

/**
 * Put accrued fee revenue to work: the treasury invests its cash into the most
 * subscribed public baskets. Profit realised on these positions is queued for
 * buyback-and-burn (see takePerformanceFee). Runs on the same tick as the exit
 * rules engine; no-ops when there's nothing meaningful to deploy.
 */
export async function deployTreasury(): Promise<number> {
  const db = getDb();
  const tid = treasuryUserId();
  const cash = (
    db.prepare("SELECT cash FROM users WHERE id = ?").get(tid) as { cash: number } | undefined
  )?.cash ?? 0;
  const deployable = cash - DEPLOY_FLOOR_USD;
  if (deployable < 50) return 0;

  const targets = db
    .prepare(
      `SELECT b.id, b.name,
              (SELECT COUNT(DISTINCT user_id) FROM holdings h WHERE h.basket_id = b.id AND h.qty > 0) +
              (SELECT COUNT(*) FROM trader_holdings th WHERE th.basket_id = b.id AND th.units > 0) AS investors
       FROM baskets b
       WHERE b.is_public = 1 AND b.kind = 'coin' AND b.owner_id != ?
       ORDER BY investors DESC, b.id ASC
       LIMIT ?`
    )
    .all(tid, DEPLOY_MAX_BASKETS) as { id: number; name: string; investors: number }[];
  if (targets.length === 0) return 0;

  const per = Math.floor((deployable / targets.length) * 100) / 100;
  if (per < 1) return 0;

  const { investInBasket } = await import("./portfolio");
  let deployed = 0;
  for (const t of targets) {
    try {
      await investInBasket(tid, t.id, per);
      deployed += per;
      recordLedger({
        kind: "deploy",
        amountUsd: 0,
        basketId: t.id,
        detail: `Deployed $${per.toFixed(2)} of fee revenue into ${t.name}`,
      });
    } catch {
      // price feed down or basket unusable — try again next tick
    }
  }
  return deployed;
}

export function getLedger(limit = 50): LedgerRow[] {
  return getDb()
    .prepare("SELECT * FROM treasury_ledger ORDER BY ts DESC, id DESC LIMIT ?")
    .all(limit) as LedgerRow[];
}

/** Treasury inflow by day, for the burn chart. */
export function getTreasuryDaily(days = 30): { ts: number; inflow: number; burned: number }[] {
  const db = getDb();
  const since = Date.now() - days * 86_400_000;
  const rows = db
    .prepare(
      "SELECT ts, kind, amount_usd FROM treasury_ledger WHERE ts >= ? ORDER BY ts ASC"
    )
    .all(since) as { ts: number; kind: LedgerKind; amount_usd: number }[];
  const byDay = new Map<number, { inflow: number; burned: number }>();
  for (const r of rows) {
    const day = Math.floor(r.ts / 86_400_000) * 86_400_000;
    const cur = byDay.get(day) ?? { inflow: 0, burned: 0 };
    if (r.kind === "burn") cur.burned += Math.abs(r.amount_usd);
    else cur.inflow += r.amount_usd;
    byDay.set(day, cur);
  }
  return [...byDay.entries()].map(([ts, v]) => ({ ts, ...v })).sort((a, b) => a.ts - b.ts);
}
