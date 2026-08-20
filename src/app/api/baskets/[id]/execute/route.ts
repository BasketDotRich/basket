import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getBasket, getBasketTokens } from "@/lib/portfolio";
import {
  SwapError,
  buildSwapTransactions,
  quoteBasketLegs,
} from "@/lib/swap";

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Build the real, unsigned swap transactions for investing in a coin basket.
 * The server signs nothing here — the caller's wallet signs.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { id } = await ctx.params;
  const basket = getBasket(Number(id));
  if (!basket) return NextResponse.json({ error: "Basket not found" }, { status: 404 });
  if (!basket.is_public && basket.owner_id !== user.id) {
    return NextResponse.json({ error: "Basket not found" }, { status: 404 });
  }
  if (basket.kind !== "coin") {
    return NextResponse.json(
      { error: "Trader baskets mirror wallets and can't be swapped into directly yet" },
      { status: 400 }
    );
  }

  let body: { wallet?: string; amountSol?: number; slippageBps?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const wallet = (body.wallet ?? "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return NextResponse.json({ error: "Connect a wallet first" }, { status: 400 });
  }
  const amountSol = Number(body.amountSol);
  if (!Number.isFinite(amountSol) || amountSol < 0.01) {
    return NextResponse.json({ error: "Minimum is 0.01 SOL" }, { status: 400 });
  }
  const slippageBps = Math.min(Math.max(Number(body.slippageBps ?? 100), 10), 2000);

  const tokens = getBasketTokens(basket.id);
  if (tokens.length === 0) {
    return NextResponse.json({ error: "Basket has no tokens" }, { status: 400 });
  }

  try {
    const legs = await quoteBasketLegs(
      tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, weight: t.weight })),
      Math.floor(amountSol * LAMPORTS_PER_SOL),
      slippageBps
    );
    const transactions = await buildSwapTransactions(legs, wallet);
    return NextResponse.json({
      transactions,
      legs: legs.map((l) => ({
        symbol: l.symbol,
        mint: l.mint,
        solIn: l.lamportsIn / LAMPORTS_PER_SOL,
        outAmount: l.outAmount,
        priceImpactPct: l.priceImpactPct,
      })),
      basket: { id: basket.id, name: basket.name },
    });
  } catch (e) {
    if (e instanceof SwapError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("execute build failed", e);
    return NextResponse.json({ error: "Could not build the swaps" }, { status: 500 });
  }
}
