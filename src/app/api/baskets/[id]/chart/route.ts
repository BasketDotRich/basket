import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getBasketIndex, getHistory } from "@/lib/prices";
import { getTraderBasketCurveLive } from "@/lib/wallets";
import { getBasket, getBasketTokens } from "@/lib/portfolio";

/** SOL indexed to 100 over the same window, as the benchmark series. */
async function solBenchmark(days: number, startTs?: number): Promise<[number, number][]> {
  const sol = await getHistory("solana", days);
  const inWindow = startTs ? sol.filter((p) => p[0] >= startTs) : sol;
  if (inWindow.length < 2) return [];
  const base = inWindow[0][1];
  if (!(base > 0)) return [];
  return inWindow.map(([ts, v]) => [ts, (v / base) * 100]);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const basket = getBasket(Number(id));
  if (!basket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!basket.is_public) {
    const user = await getUser();
    if (basket.owner_id !== user?.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const daysParam = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;

  if (basket.kind === "coin") {
    const tokens = getBasketTokens(basket.id);
    const { points, coverage } = await getBasketIndex(
      tokens.map((t) => ({ mint: t.mint, weight: t.weight })),
      days
    );
    const benchmark = points.length >= 2 ? await solBenchmark(days, points[0][0]) : [];
    return NextResponse.json({ points, benchmark, coverage, days, source: "coingecko" });
  }

  // Real snapshot-based curve; sparse until tracking history accumulates.
  const points = getTraderBasketCurveLive(basket.id, days);
  const benchmark = points.length >= 2 ? await solBenchmark(days, points[0][0]) : [];
  return NextResponse.json({ points, benchmark, coverage: 1, days, source: "onchain" });
}
