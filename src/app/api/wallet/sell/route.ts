import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { SwapError } from "@/lib/swap";
import { CustodyError, TradingError, sellTokenOnchain } from "@/lib/trading";

declare global {
  // eslint-disable-next-line no-var
  var __bSellThrottle: Map<number, number> | undefined;
}
const throttle = (globalThis.__bSellThrottle ??= new Map());

/** Sell a held token back to SOL with the account wallet. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const last = throttle.get(user.id) ?? 0;
  if (Date.now() - last < 10_000) {
    return NextResponse.json({ error: "Give the last trade a few seconds to settle" }, { status: 429 });
  }

  let body: { mint?: string; fraction?: number; slippageBps?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof body.mint !== "string") {
    return NextResponse.json({ error: "Missing mint" }, { status: 400 });
  }
  const slippageBps = Math.min(Math.max(Number(body.slippageBps ?? 100), 10), 2000);

  try {
    throttle.set(user.id, Date.now());
    const result = await sellTokenOnchain(
      user.id,
      body.mint,
      Number(body.fraction ?? 1),
      slippageBps
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof TradingError || e instanceof SwapError || e instanceof CustodyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("onchain sell failed", e);
    return NextResponse.json(
      { error: "The sell failed — check your wallet on Solscan before retrying" },
      { status: 500 }
    );
  }
}
