import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getBasket, getBasketTokens } from "@/lib/portfolio";
import { SwapError } from "@/lib/swap";
import { CustodyError, TradingError, buyBasketOnchain } from "@/lib/trading";

// One on-chain buy at a time per user — swaps are irreversible.
declare global {
  // eslint-disable-next-line no-var
  var __bBuyThrottle: Map<number, number> | undefined;
}
const throttle = (globalThis.__bBuyThrottle ??= new Map());

/** Execute a REAL basket buy with the account wallet's SOL. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const last = throttle.get(user.id) ?? 0;
  if (Date.now() - last < 10_000) {
    return NextResponse.json({ error: "Give the last buy a few seconds to settle" }, { status: 429 });
  }

  const { id } = await ctx.params;
  const basket = getBasket(Number(id));
  if (!basket || (!basket.is_public && basket.owner_id !== user.id)) {
    return NextResponse.json({ error: "Basket not found" }, { status: 404 });
  }
  if (basket.kind !== "coin") {
    return NextResponse.json(
      { error: "Trader baskets mirror wallets and can't be bought on-chain yet" },
      { status: 400 }
    );
  }

  let body: { amountSol?: number; slippageBps?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const slippageBps = Math.min(Math.max(Number(body.slippageBps ?? 100), 10), 2000);

  const tokens = getBasketTokens(basket.id);
  if (tokens.length === 0) {
    return NextResponse.json({ error: "Basket has no tokens" }, { status: 400 });
  }

  try {
    throttle.set(user.id, Date.now());
    const result = await buyBasketOnchain(
      user.id,
      { id: basket.id, name: basket.name },
      tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, weight: t.weight })),
      Number(body.amountSol),
      slippageBps
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof TradingError || e instanceof SwapError || e instanceof CustodyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("onchain buy failed", e);
    return NextResponse.json(
      { error: "The buy failed — check your wallet on Solscan before retrying" },
      { status: 500 }
    );
  }
}
