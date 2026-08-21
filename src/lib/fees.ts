// Platform swap fee, taken in SOL.
//
// WHY NOT JUPITER'S platformFeeBps: Jupiter charges its platform fee in the
// swap's OUTPUT mint. On a sell that is SOL (fine), but on a BUY the output is
// the memecoin — so collecting it would require a referral token account for
// every mint in the app, created before anyone could trade it. A user buying a
// token listed ten minutes ago would just get a failed swap.
//
// Skimming in SOL sidesteps all of that: one currency, one destination, works
// for any token, and the amount is legible to the user in the same unit they
// deposited. Buys skim before routing; sells skim from the proceeds.
import { getDb } from "./db";

export const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 50);
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Lamports the platform takes from a given SOL amount. */
export function swapFeeLamports(lamports: number): number {
  if (!(PLATFORM_FEE_BPS > 0)) return 0;
  return Math.floor((lamports * PLATFORM_FEE_BPS) / 10_000);
}

/**
 * Move the swap fee to the treasury and record it.
 *
 * Returns the lamports actually collected — 0 when there is no treasury wallet
 * configured or the amount is dust. Never throws: a fee that cannot be
 * collected must never block someone's trade, and the ledger records the
 * waiver honestly rather than pretending it was taken.
 */
export async function collectSwapFee(args: {
  userId: number;
  basketId: number;
  lamports: number;
  side: "buy" | "sell";
  solPrice: number;
}): Promise<{ lamports: number; signature: string | null }> {
  const fee = swapFeeLamports(args.lamports);
  if (fee <= 0) return { lamports: 0, signature: null };

  const { treasuryWallet, recordLedger } = await import("./treasury");
  const dest = treasuryWallet();
  const usd = (fee / LAMPORTS_PER_SOL) * args.solPrice;

  // Below the network fee it costs more to send than it is worth.
  if (!dest || fee < 50_000) {
    recordLedger({
      kind: "swap_fee",
      amountUsd: 0,
      amountSol: 0,
      userId: args.userId,
      basketId: args.basketId,
      detail: dest
        ? `Swap fee waived — below dust threshold (${args.side})`
        : `Swap fee waived — TREASURY_WALLET not configured (${args.side})`,
    });
    return { lamports: 0, signature: null };
  }

  try {
    const { getAccountWallet, signSendConfirmOne } = await import("./accounts");
    const { buildSolTransfer } = await import("./swap");
    const wallet = getAccountWallet(args.userId);
    if (!wallet) return { lamports: 0, signature: null };
    const tx = await buildSolTransfer(wallet.address, dest, fee);
    const signature = await signSendConfirmOne(args.userId, tx);
    recordLedger({
      kind: "swap_fee",
      amountUsd: usd,
      amountSol: fee / LAMPORTS_PER_SOL,
      userId: args.userId,
      basketId: args.basketId,
      detail: `${PLATFORM_FEE_BPS / 100}% swap fee on ${args.side} · ${signature}`,
    });
    return { lamports: fee, signature };
  } catch {
    // Accrue what was owed so the books stay honest even when the transfer
    // failed; the trade itself is unaffected.
    getDb();
    recordLedger({
      kind: "swap_fee",
      amountUsd: usd,
      amountSol: fee / LAMPORTS_PER_SOL,
      userId: args.userId,
      basketId: args.basketId,
      detail: `${PLATFORM_FEE_BPS / 100}% swap fee accrued on ${args.side} — transfer failed`,
    });
    return { lamports: 0, signature: null };
  }
}
