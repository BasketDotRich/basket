// Protocol treasury & buyback-burn accounting. REAL MONEY ONLY.
//
// Two revenue streams, all recorded in treasury_ledger:
//   1. PERFORMANCE FEE — 10% of REALISED PROFIT on every redeem. Charged on
//      gains only: never on principal, never on a loss. Collected as a real
//      SOL transfer from the account wallet to TREASURY_WALLET at redeem time
//      (accrued on the ledger either way, so nothing is ever lost).
//   2. CREATION FEE — 0.5 SOL per basket created, a real on-chain SOL
//      transfer from the creator's account wallet to TREASURY_WALLET.
//
// Everything routes to buyback-and-burn of the platform token. Pre-token the
// ledger is a faithful ACCRUAL record — every number is what the burn engine
// executes against at launch. Nothing is presented as a burn that hasn't
// happened on-chain.
import { getDb } from "./db";
import { getPrices } from "./prices";
import { SOL_MINT } from "./wallets";

export const PERFORMANCE_FEE_BPS = 1000; // 10% of realised profit
export const CREATION_FEE_SOL = 0.5;

export type LedgerKind =
  | "performance_fee"
  | "creation_fee"
  | "swap_fee"
  | "treasury_pnl"
  | "deploy"
  | "burn";

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

export function treasuryWallet(): string | null {
  const w = process.env.TREASURY_WALLET?.trim();
  return w && w.length >= 32 ? w : null;
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
 * Record the performance fee on a realised gain. Returns the fee in USD
 * (0 when the redeem was flat or a loss). The CALLER settles it — by keeping
 * that slice of the redeem's SOL proceeds and forwarding it on-chain to the
 * treasury wallet. This function only writes the accrual ledger row, so fee
 * and payout can never diverge from what was recorded.
 */
export function takePerformanceFee(args: {
  userId: number;
  basketId: number;
  basketName: string;
  proceeds: number;
  costRedeemed: number;
  settledSol?: number | null;
  settledSig?: string | null;
}): number {
  const profit = args.proceeds - args.costRedeemed;
  if (!(profit > 0)) return 0;
  const fee = (profit * PERFORMANCE_FEE_BPS) / 10_000;
  if (!(fee > 0)) return 0;
  getDb()
    .prepare(
      "INSERT INTO treasury_ledger (ts, kind, amount_usd, amount_sol, user_id, basket_id, detail) VALUES (?, 'performance_fee', ?, ?, ?, ?, ?)"
    )
    .run(
      Date.now(),
      fee,
      args.settledSol ?? null,
      args.userId,
      args.basketId,
      `10% of $${profit.toFixed(2)} profit on ${args.basketName}` +
        (args.settledSig
          ? ` · on-chain ${args.settledSig}`
          : " · accrued (treasury wallet not configured)")
    );
  return fee;
}

export class TreasuryError extends Error {}

/**
 * Charge the 0.5 SOL basket-creation fee as a REAL on-chain transfer from the
 * creator's account wallet to the treasury wallet. When TREASURY_WALLET isn't
 * configured yet the fee is waived — recorded on the ledger as such, never
 * silently — because there is nowhere real to send it.
 */
export async function chargeCreationFee(
  userId: number,
  basketName: string,
  basketId: number
): Promise<{ sol: number; usd: number; signature: string | null; waived: boolean }> {
  const price = await solPriceUsd();
  if (price == null) {
    throw new TreasuryError("SOL price unavailable — can't price the creation fee right now");
  }
  const usd = CREATION_FEE_SOL * price;
  const dest = treasuryWallet();

  if (!dest) {
    recordLedger({
      kind: "creation_fee",
      amountUsd: 0,
      amountSol: 0,
      userId,
      basketId,
      detail: `Fee waived for "${basketName}" — TREASURY_WALLET not configured`,
    });
    return { sol: 0, usd: 0, signature: null, waived: true };
  }

  const { getAccountWallet, getSolBalance, signSendConfirmOne, LAMPORTS_PER_SOL, WITHDRAW_RESERVE_LAMPORTS } =
    await import("./accounts");
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new TreasuryError("This account has no wallet yet");
  const lamports = Math.floor(CREATION_FEE_SOL * LAMPORTS_PER_SOL);
  const balance = await getSolBalance(wallet.address);
  if (lamports + WITHDRAW_RESERVE_LAMPORTS > balance) {
    throw new TreasuryError(
      `Creating a basket costs ${CREATION_FEE_SOL} SOL (≈$${usd.toFixed(2)}) — deposit SOL to your wallet first`
    );
  }
  const { buildSolTransfer } = await import("./swap");
  const tx = await buildSolTransfer(wallet.address, dest, lamports);
  // Confirmed, not just accepted — a dropped transfer must never book revenue.
  const signature = await signSendConfirmOne(userId, tx);

  const db = getDb();
  // basket_id is bound directly: a MAX(id) back-patch would cross-attribute
  // fees whenever two people create a basket at the same moment.
  db.prepare(
    "INSERT INTO treasury_ledger (ts, kind, amount_usd, amount_sol, user_id, basket_id, detail) VALUES (?, 'creation_fee', ?, ?, ?, ?, ?)"
  ).run(
    Date.now(),
    usd,
    CREATION_FEE_SOL,
    userId,
    basketId,
    `${CREATION_FEE_SOL} SOL to create "${basketName}" · ${signature}`
  );
  db.prepare(
    "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'fee', NULL, ?, ?, ?)"
  ).run(
    userId,
    usd,
    `Basket creation fee — ${CREATION_FEE_SOL} SOL → buyback & burn · ${signature}`,
    Date.now()
  );
  return { sol: CREATION_FEE_SOL, usd, signature, waived: false };
}

export type TreasuryStats = {
  performanceFees: number;
  creationFees: number;
  creationFeesSol: number;
  collectedSol: number;
  burned: number;
  pendingBurn: number;
  totalInflow: number;
  basketsCreated: number;
};

/** Roll up the ledger — pure accrual, every row backed by a real event. */
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
  const performanceFeesSol = sum("performance_fee", "amount_sol");
  const burned = Math.abs(sum("burn"));

  const basketsCreated = (
    db.prepare("SELECT COUNT(*) AS n FROM treasury_ledger WHERE kind = 'creation_fee'").get() as {
      n: number;
    }
  ).n;

  const totalInflow = performanceFees + creationFees;
  return {
    performanceFees,
    creationFees,
    creationFeesSol,
    collectedSol: creationFeesSol + performanceFeesSol,
    burned,
    pendingBurn: Math.max(0, totalInflow - burned),
    totalInflow,
    basketsCreated,
  };
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
