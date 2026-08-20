import { NextResponse } from "next/server";
import { getCandles, type CandleFrame } from "@/lib/gecko";

const FRAMES: CandleFrame[] = ["15m", "1h", "4h", "1d"];

export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "Bad mint" }, { status: 400 });
  }
  const frameParam = new URL(req.url).searchParams.get("frame") as CandleFrame | null;
  const frame = frameParam && FRAMES.includes(frameParam) ? frameParam : "1h";
  const candles = await getCandles(mint, frame, 220);
  return NextResponse.json({ candles, frame, source: "geckoterminal" });
}
