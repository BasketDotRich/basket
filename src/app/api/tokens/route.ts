import { NextResponse } from "next/server";
import { getMarketRows } from "@/lib/market";

export async function GET(req: Request) {
  const { rows, sol } = await getMarketRows();
  // ?spark=0 → drop the 7-day sparkline arrays (the heavy part of the payload).
  // The markets table polls with this and keeps its previously loaded sparks.
  if (new URL(req.url).searchParams.get("spark") === "0") {
    return NextResponse.json({
      tokens: rows.map((r) => ({ ...r, sparkline: [] })),
      sol,
    });
  }
  return NextResponse.json({ tokens: rows, sol });
}
