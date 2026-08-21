// Buyback & burn — the last stage of the fee loop.
//
// Realised treasury profit buys $BASKET off the open market, and those tokens
// are sent to the incinerator address, which nobody can spend from. Supply
// goes down and never comes back.
//
// Executed by the BURN OPERATOR wallet, not the treasury. The operator is
// topped up per cycle and holds only what the current burn needs, so a server
// compromise costs one cycle rather than the whole treasury.
import { getDb } from "./db";
import { BASKET_MINT, BURN_ADDRESS, recordLedger, solPriceUsd } from "./treasury";

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Don't burn dust — below this the swap and transfer cost more than the burn. */
const MIN_BURN_LAMPORTS = 20_000_000; // 0.02 SOL
/** Leave the operator enough for network fees and the ATA it may need. */
const OPERATOR_RESERVE = 8_000_000; // 0.008 SOL

export function burnConfigured(): boolean {
  return (
    !!process.env.BURN_OPERATOR_WALLET?.trim() &&
    !!process.env.BURN_OPERATOR_KEY?.trim() &&
    !!process.env.TREASURY_WALLET_KEY?.trim()
  );
}

/**
 * USD of realised profit queued but not yet burned.
 * treasury_pnl rows are the credits; burn rows are the debits.
 */
export function queuedForBurnUsd(): number {
  const db = getDb();
  const q = (kind: string) =>
    (
      db
        .prepare("SELECT COALESCE(SUM(amount_usd),0) AS v FROM treasury_ledger WHERE kind = ?")
        .get(kind) as { v: number }
    ).v;
  return Math.max(0, q("treasury_pnl") - Math.abs(q("burn")));
}

export type BurnResult = {
  burned: boolean;
  solSpent: number;
  tokensBurned: number;
  buySig: string | null;
  burnSig: string | null;
  skipped: string | null;
};

const NONE: BurnResult = {
  burned: false, solSpent: 0, tokensBurned: 0, buySig: null, burnSig: null, skipped: null,
};

/**
 * Run one buyback-and-burn cycle.
 *
 * Deliberately sequential and fully confirmed at each step: fund the operator,
 * buy, then burn. If any step fails the cycle stops — a half-finished burn is
 * recoverable (SOL or tokens simply sit in the operator and the next cycle
 * picks them up), but a mis-recorded one would corrupt the public ledger.
 */
export async function runBurnCycle(): Promise<BurnResult> {
  if (!burnConfigured()) return { ...NONE, skipped: "burn wallets not configured" };

  const queuedUsd = queuedForBurnUsd();
  if (queuedUsd <= 0) return { ...NONE, skipped: "nothing queued" };

  const sol = (await solPriceUsd()) ?? 0;
  if (sol <= 0) return { ...NONE, skipped: "no SOL price" };

  const wantLamports = Math.floor((queuedUsd / sol) * LAMPORTS_PER_SOL);
  if (wantLamports < MIN_BURN_LAMPORTS) return { ...NONE, skipped: "queued amount is dust" };

  const { getSolBalance, signSendConfirmOneWith } = await import("./accounts");
  const operator = process.env.BURN_OPERATOR_WALLET!.trim();
  const operatorKey = process.env.BURN_OPERATOR_KEY!.trim();
  const treasury = process.env.TREASURY_WALLET!.trim();
  const treasuryKey = process.env.TREASURY_WALLET_KEY!.trim();

  try {
    // 1. Top the operator up for exactly this cycle.
    const opBalance = await getSolBalance(operator).catch(() => 0);
    const needed = wantLamports + OPERATOR_RESERVE - opBalance;
    if (needed > 0) {
      const treasuryBalance = await getSolBalance(treasury).catch(() => 0);
      if (treasuryBalance < needed + OPERATOR_RESERVE) {
        return { ...NONE, skipped: "treasury cannot fund this burn yet" };
      }
      const { buildSolTransfer } = await import("./swap");
      const fundTx = await buildSolTransfer(treasury, operator, needed);
      await signSendConfirmOneWith(treasuryKey, fundTx);
    }

    // 2. Buy $BASKET on the open market with the operator's SOL.
    const spendable = Math.min(
      wantLamports,
      Math.max(0, (await getSolBalance(operator)) - OPERATOR_RESERVE)
    );
    if (spendable < MIN_BURN_LAMPORTS) return { ...NONE, skipped: "operator underfunded" };

    const { quoteBasketLegs, buildSwapTransactions } = await import("./swap");
    const legs = await quoteBasketLegs(
      [{ mint: BASKET_MINT, symbol: "BASKET", weight: 1 }],
      spendable,
      300
    );
    if (legs.length === 0) return { ...NONE, skipped: "no route to buy BASKET" };
    const [buyTx] = await buildSwapTransactions(legs, operator);
    const buySig = await signSendConfirmOneWith(operatorKey, buyTx);
    const tokens = Number(legs[0].outAmount) / 1e6;

    // 3. Send them where they can never come back from.
    const { buildTokenTransfer } = await import("./swap");
    const burnTx = await buildTokenTransfer(
      operator,
      BURN_ADDRESS,
      BASKET_MINT,
      legs[0].outAmount
    );
    const burnSig = await signSendConfirmOneWith(operatorKey, burnTx);

    const usdBurned = (spendable / LAMPORTS_PER_SOL) * sol;
    recordLedger({
      kind: "burn",
      amountUsd: -usdBurned,
      amountSol: -(spendable / LAMPORTS_PER_SOL),
      detail: `Bought and burned ${tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} BASKET · buy ${buySig} · burn ${burnSig}`,
    });

    return {
      burned: true,
      solSpent: spendable / LAMPORTS_PER_SOL,
      tokensBurned: tokens,
      buySig,
      burnSig,
      skipped: null,
    };
  } catch (e) {
    // Nothing is recorded on a failure, so the queue is untouched and the next
    // cycle retries. Any SOL or tokens left in the operator are picked up then.
    console.error("[burn] cycle failed", e);
    return { ...NONE, skipped: e instanceof Error ? e.message : "burn failed" };
  }
}
