import { NextResponse } from "next/server";
import { isCurated } from "@/lib/tokens";

// Jupiter token search proxy — returns EVERYTHING Jupiter can route, including
// pre-bond pump.fun coins. Risk is labeled (verified/organic), never hidden:
// unverified tokens carry a warn flag in the UI instead of being blocked.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ tokens: [] });
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`jupiter ${res.status}`);
    const list = (await res.json()) as Array<{
      id: string;
      symbol?: string;
      name?: string;
      decimals?: number;
      icon?: string;
      mcap?: number;
      usdPrice?: number;
      isVerified?: boolean;
      organicScore?: number;
      bondingCurve?: number;
      stats24h?: { priceChange?: number };
    }>;
    const tokens = (list ?? [])
      // A token Jupiter can't price can't be bought or valued — offering it
      // would let someone pay the creation fee for a basket that can never
      // trade. Skip, don't disable-and-show: dead mints are noise, not choice.
      .filter((t) => (t.usdPrice ?? 0) > 0)
      .slice(0, 20)
      .map((t) => ({
        mint: t.id,
        symbol: (t.symbol ?? "?").trim(),
        name: (t.name ?? "Unknown").trim(),
        // Jupiter already knows the token's real icon — use it. Guessing a
        // DexScreener URL 404s for anything it hasn't indexed, which is exactly
        // the new low-cap coins this list exists to surface.
        icon:
          t.icon?.trim() ||
          `https://dd.dexscreener.com/ds-data/tokens/solana/${t.id}.png?size=lg`,
        decimals: t.decimals ?? 6,
        price: t.usdPrice ?? null,
        mcap: t.mcap ?? null,
        change24h: t.stats24h?.priceChange ?? null,
        curated: isCurated(t.id),
        verified: !!t.isVerified,
        organic: Math.round(t.organicScore ?? 0),
      }))
      .sort((a, b) => Number(b.verified) - Number(a.verified) || (b.mcap ?? 0) - (a.mcap ?? 0));
    return NextResponse.json({ tokens });
  } catch {
    return NextResponse.json({ tokens: [], error: "Search unavailable" }, { status: 502 });
  }
}
