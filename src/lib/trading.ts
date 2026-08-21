// On-chain execution with the account wallet: real Jupiter swaps, signed by
// the account's own key, tokens land in the account's own wallet. The practice
// balance is a separate sandbox and never touches this path.
import { getDb } from "./db";
import { CustodyError } from "./custody";
import {
  LAMPORTS_PER_SOL,
  WITHDRAW_RESERVE_LAMPORTS,
  getAccountWallet,
  getSolBalance,
  signAndSendForAccount,
} from "./accounts";
import {
  SwapError,
  buildSwapTransactions,
  quoteBasketLegs,
  quoteExitLegs,
} from "./swap";
import { getPrices } from "./prices";
import { mintSymbol, SOL_MINT } from "./wallets";
import { solPriceUsd } from "./treasury";

export class TradingError extends Error {}

const MIN_BUY_SOL = 0.01;

export type AccountHolding = {
  mint: string;
  symbol: string;
  name: string | null;
  icon: string | null;
  amount: number;
  rawAmount: string;
  price: number | null;
  valueUsd: number;
};

export type AccountHoldings = {
  address: string;
  sol: number;
  solUsd: number;
  tokens: AccountHolding[];
  totalUsd: number;
};

/** Everything the account wallet holds, priced where Jupiter can price it. */
export async function getAccountHoldings(userId: number): Promise<AccountHoldings> {
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new TradingError("This account has no wallet yet");

  const res = await fetch(`https://lite-api.jup.ag/ultra/v1/balances/${wallet.address}`, {
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new TradingError("Couldn't read the wallet right now — try again");
  const data = (await res.json()) as Record<
    string,
    { amount?: string; uiAmount?: number; isFrozen?: boolean }
  >;

  let sol = 0;
  const raw: { mint: string; amount: number; rawAmount: string }[] = [];
  for (const [key, v] of Object.entries(data)) {
    if (key === "SOL") sol = v.uiAmount ?? 0;
    else if (!v.isFrozen && (v.uiAmount ?? 0) > 0) {
      raw.push({ mint: key, amount: v.uiAmount!, rawAmount: v.amount ?? "0" });
    }
  }

  const db = getDb();
  const [prices, solUsdPrice] = await Promise.all([
    getPrices(raw.map((r) => r.mint)),
    solPriceUsd(),
  ]);
  const tokens: AccountHolding[] = raw
    .map((r) => {
      const meta = db
        .prepare("SELECT symbol, name, icon FROM token_meta WHERE mint = ?")
        .get(r.mint) as { symbol: string; name: string; icon: string | null } | undefined;
      const price = prices[r.mint]?.usdPrice ?? null;
      return {
        mint: r.mint,
        symbol: meta?.symbol ?? mintSymbol(r.mint),
        name: meta?.name ?? null,
        icon:
          meta?.icon ?? `https://dd.dexscreener.com/ds-data/tokens/solana/${r.mint}.png?size=lg`,
        amount: r.amount,
        rawAmount: r.rawAmount,
        price,
        valueUsd: price != null ? r.amount * price : 0,
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const solUsd = sol * (solUsdPrice ?? 0);
  return {
    address: wallet.address,
    sol,
    solUsd,
    tokens,
    totalUsd: solUsd + tokens.reduce((s, t) => s + t.valueUsd, 0),
  };
}

function recordTrade(userId: number, amountUsd: number, detail: string): void {
  getDb()
    .prepare(
      "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'trade', NULL, ?, ?, ?)"
    )
    .run(userId, amountUsd, detail, Date.now());
}

/**
 * Buy every leg of a coin basket on-chain with the account wallet's SOL.
 * Returns the executed legs with their transaction signatures.
 */
export async function buyBasketOnchain(
  userId: number,
  basket: { id: number; name: string },
  legs: { mint: string; symbol: string; weight: number }[],
  amountSol: number,
  slippageBps: number
): Promise<{ signatures: string[]; legs: { symbol: string; solIn: number }[] }> {
  if (!Number.isFinite(amountSol) || amountSol < MIN_BUY_SOL) {
    throw new TradingError(`Minimum is ${MIN_BUY_SOL} SOL`);
  }
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new TradingError("This account has no wallet yet");

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const balance = await getSolBalance(wallet.address);
  // reserve covers rent + priority fees across the legs
  if (lamports + WITHDRAW_RESERVE_LAMPORTS > balance) {
    const max = Math.max(0, balance - WITHDRAW_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL;
    throw new TradingError(
      max >= MIN_BUY_SOL
        ? `Not enough SOL — you can buy with up to ${max.toFixed(4)} SOL`
        : "Deposit SOL to your account wallet first"
    );
  }

  const quoted = await quoteBasketLegs(legs, lamports, slippageBps);
  const txs = await buildSwapTransactions(quoted, wallet.address);
  const signatures = await signAndSendForAccount(userId, txs);

  const sol = (await solPriceUsd()) ?? 0;
  quoted.forEach((leg, i) => {
    recordTrade(
      userId,
      (leg.lamportsIn / LAMPORTS_PER_SOL) * sol,
      `On-chain buy ${leg.symbol} for "${basket.name}" · ${signatures[i] ?? ""}`
    );
  });
  return {
    signatures,
    legs: quoted.map((l) => ({ symbol: l.symbol, solIn: l.lamportsIn / LAMPORTS_PER_SOL })),
  };
}

/** Sell a fraction of one held token back to SOL, on-chain. */
export async function sellTokenOnchain(
  userId: number,
  mint: string,
  fraction: number,
  slippageBps: number
): Promise<{ signature: string; symbol: string }> {
  if (mint === SOL_MINT) throw new TradingError("SOL is already SOL — use withdraw");
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new TradingError("Fraction must be between 0 and 1");
  }
  const holdings = await getAccountHoldings(userId);
  const held = holdings.tokens.find((t) => t.mint === mint);
  if (!held || BigInt(held.rawAmount) <= BigInt(0)) {
    throw new TradingError("You don't hold that token");
  }
  const rawAmount = (BigInt(held.rawAmount) * BigInt(Math.floor(fraction * 10_000))) / BigInt(10_000);
  if (rawAmount <= BigInt(0)) throw new TradingError("Amount too small");

  const quoted = await quoteExitLegs(
    [{ mint, symbol: held.symbol, rawAmount: rawAmount.toString() }],
    slippageBps
  );
  if (quoted.length === 0) {
    throw new SwapError(`No route to sell ${held.symbol} right now`);
  }
  const txs = await buildSwapTransactions(quoted, holdings.address);
  const signatures = await signAndSendForAccount(userId, txs);

  // The tokens are gone from the wallet, so they must go from the basket
  // ledger too. Without this a wallet-level sell leaves phantom positions:
  // the portfolio keeps valuing coins you no longer own, and exit rules keep
  // evaluating — and eventually "auto-selling" — a position that isn't there.
  reduceLedgerHoldings(userId, mint, fraction);

  recordTrade(
    userId,
    held.valueUsd * fraction,
    `On-chain sell ${held.symbol} → SOL · ${signatures[0] ?? ""}`
  );
  return { signature: signatures[0], symbol: held.symbol };
}

/**
 * Apply a wallet-level sell to every basket that recorded this mint.
 *
 * A token can be held by more than one basket, so the sale is spread across
 * them proportionally — the same fraction comes off each, which keeps each
 * basket's cost basis intact and stops one basket absorbing another's sale.
 */
function reduceLedgerHoldings(userId: number, mint: string, fraction: number): void {
  const db = getDb();
  const rows = db
    .prepare("SELECT basket_id, qty FROM holdings WHERE user_id = ? AND mint = ? AND qty > 0")
    .all(userId, mint) as { basket_id: number; qty: number }[];
  if (rows.length === 0) return;

  db.exec("BEGIN");
  try {
    for (const r of rows) {
      if (fraction >= 0.9999) {
        db.prepare("DELETE FROM holdings WHERE user_id = ? AND basket_id = ? AND mint = ?").run(
          userId, r.basket_id, mint
        );
      } else {
        db.prepare(
          "UPDATE holdings SET qty = qty * ?, cost = cost * ? WHERE user_id = ? AND basket_id = ? AND mint = ?"
        ).run(1 - fraction, 1 - fraction, userId, r.basket_id, mint);
      }
    }
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
  }
}

export { CustodyError };
