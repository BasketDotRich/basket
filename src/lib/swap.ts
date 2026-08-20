// Real, non-custodial execution via Jupiter.
//
// The server only ever BUILDS transactions — it holds no keys and no funds.
// Every transaction is signed by the user's own wallet, and the tokens land in
// the user's own wallet. That is what keeps this outside money-transmission:
// under FinCEN's 2019 CVC guidance, non-custodial software that never controls
// user funds is not a money transmitter.
//
// Fees:
//   • platformFeeBps on each swap → Jupiter routes it to our referral token
//     account automatically (needs PLATFORM_FEE_ACCOUNT configured).
//   • the 0.5 SOL basket-creation fee is a plain SOL transfer the user signs.
import { SOL_MINT } from "./wallets";

const JUP = process.env.JUPITER_API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";
const JUP_HEADERS: Record<string, string> = process.env.JUPITER_API_KEY
  ? { "x-api-key": process.env.JUPITER_API_KEY }
  : {};

export const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 50); // 0.50% default

export class SwapError extends Error {}

export type QuoteLeg = {
  mint: string;
  symbol: string;
  weight: number;
  lamportsIn: number;
  quote: unknown;
  outAmount: string;
  priceImpactPct: number;
};

export function rpcUrl(): string {
  return (
    process.env.HELIUS_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    "https://api.mainnet-beta.solana.com"
  );
}

/** Quote SOL → each basket leg, sized by weight. */
export async function quoteBasketLegs(
  legs: { mint: string; symbol: string; weight: number }[],
  totalLamports: number,
  slippageBps: number
): Promise<QuoteLeg[]> {
  const out: QuoteLeg[] = [];
  for (const leg of legs) {
    const lamportsIn = Math.floor(totalLamports * leg.weight);
    if (lamportsIn < 1000) {
      throw new SwapError(`Allocation for ${leg.symbol} is too small to route`);
    }
    const params = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: leg.mint,
      amount: String(lamportsIn),
      slippageBps: String(slippageBps),
    });
    if (PLATFORM_FEE_BPS > 0 && process.env.PLATFORM_FEE_ACCOUNT) {
      params.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    }
    const res = await fetch(`${JUP}/swap/v1/quote?${params}`, {
      headers: JUP_HEADERS,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) throw new SwapError(`No route for ${leg.symbol} (${res.status})`);
    const quote = (await res.json()) as { outAmount?: string; priceImpactPct?: string };
    if (!quote?.outAmount) throw new SwapError(`No route for ${leg.symbol}`);
    out.push({
      mint: leg.mint,
      symbol: leg.symbol,
      weight: leg.weight,
      lamportsIn,
      quote,
      outAmount: quote.outAmount,
      priceImpactPct: Number(quote.priceImpactPct ?? 0),
    });
  }
  return out;
}

/** Turn quotes into unsigned, base64 versioned transactions for the user. */
export async function buildSwapTransactions(
  legs: QuoteLeg[],
  userPublicKey: string
): Promise<string[]> {
  const txs: string[] = [];
  for (const leg of legs) {
    const body: Record<string, unknown> = {
      quoteResponse: leg.quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    };
    if (PLATFORM_FEE_BPS > 0 && process.env.PLATFORM_FEE_ACCOUNT) {
      body.feeAccount = process.env.PLATFORM_FEE_ACCOUNT;
    }
    const res = await fetch(`${JUP}/swap/v1/swap`, {
      method: "POST",
      headers: { "content-type": "application/json", ...JUP_HEADERS },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SwapError(`Could not build the ${leg.symbol} swap: ${text.slice(0, 120)}`);
    }
    const data = (await res.json()) as { swapTransaction?: string };
    if (!data.swapTransaction) throw new SwapError(`Empty swap for ${leg.symbol}`);
    txs.push(data.swapTransaction);
  }
  return txs;
}

/** Quote each held leg back to SOL, for exiting a position. */
export async function quoteExitLegs(
  holdings: { mint: string; symbol: string; rawAmount: string }[],
  slippageBps: number
): Promise<QuoteLeg[]> {
  const out: QuoteLeg[] = [];
  for (const h of holdings) {
    if (BigInt(h.rawAmount) <= BigInt(0)) continue;
    const params = new URLSearchParams({
      inputMint: h.mint,
      outputMint: SOL_MINT,
      amount: h.rawAmount,
      slippageBps: String(slippageBps),
    });
    if (PLATFORM_FEE_BPS > 0 && process.env.PLATFORM_FEE_ACCOUNT) {
      params.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    }
    const res = await fetch(`${JUP}/swap/v1/quote?${params}`, {
      headers: JUP_HEADERS,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) continue; // a dead leg shouldn't block exiting the rest
    const quote = (await res.json()) as { outAmount?: string; priceImpactPct?: string };
    if (!quote?.outAmount) continue;
    out.push({
      mint: h.mint,
      symbol: h.symbol,
      weight: 0,
      lamportsIn: 0,
      quote,
      outAmount: quote.outAmount,
      priceImpactPct: Number(quote.priceImpactPct ?? 0),
    });
  }
  return out;
}

/** Unsigned SOL transfer (used for the basket-creation fee). */
export async function buildSolTransfer(
  fromPubkey: string,
  toPubkey: string,
  lamports: number
): Promise<string> {
  const { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } =
    await import("@solana/web3.js");
  const conn = new Connection(rpcUrl(), "confirmed");
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const ix = SystemProgram.transfer({
    fromPubkey: new PublicKey(fromPubkey),
    toPubkey: new PublicKey(toPubkey),
    lamports,
  });
  const msg = new TransactionMessage({
    payerKey: new PublicKey(fromPubkey),
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

/** Confirm a signature actually landed, so we only record real executions. */
export async function verifySignature(signature: string): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const data = (await res.json()) as {
      result?: { value?: ({ confirmationStatus?: string; err?: unknown } | null)[] };
    };
    const st = data.result?.value?.[0];
    return !!st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized");
  } catch {
    return false;
  }
}
