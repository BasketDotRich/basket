import { NextResponse } from "next/server";
import { isCurated } from "@/lib/tokens";

// Token discovery for the basket builder. ANY Solana token can go in a basket,
// so the picker offers real feeds — not just our curated list.
//   trending → Jupiter top-trending 24h
//   organic  → highest organic-score 24h (least botted volume)
//   new      → most recently listed (high risk, labelled as such)
const FEEDS: Record<string, string> = {
  trending: "toptrending/24h",
  organic: "toporganicscore/24h",
  new: "recent",
};

type CacheEntry = { data: unknown[]; ts: number };
declare global {
  // eslint-disable-next-line no-var
  var __bDiscoverCache: Map<string, CacheEntry> | undefined;
}
const cache = (globalThis.__bDiscoverCache ??= new Map());
const TTL = 60_000;

export async function GET(req: Request) {
  const feed = new URL(req.url).searchParams.get("feed") ?? "trending";
  const path = FEEDS[feed];
  if (!path) return NextResponse.json({ error: "Unknown feed" }, { status: 400 });

  const hit = cache.get(feed);
  if (hit && Date.now() - hit.ts < TTL) {
    return NextResponse.json({ tokens: hit.data, feed });
  }

  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/${path}?limit=40`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
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
      firstPool?: { createdAt?: string };
      stats24h?: { priceChange?: number };
    }>;

    const tokens = (list ?? [])
      // a token with no price can't be bought — don't offer it
      .filter((t) => (t.usdPrice ?? 0) > 0)
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
        verified: !!t.isVerified,
        organic: Math.round(t.organicScore ?? 0),
        curated: isCurated(t.id),
        createdAt: t.firstPool?.createdAt ?? null,
      }))
      .slice(0, 30);

    cache.set(feed, { data: tokens, ts: Date.now() });
    return NextResponse.json({ tokens, feed });
  } catch {
    return NextResponse.json(
      { tokens: hit?.data ?? [], feed, error: "Feed unavailable" },
      { status: hit ? 200 : 502 }
    );
  }
}
