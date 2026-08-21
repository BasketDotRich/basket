import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { TradingError, getAccountHoldings } from "@/lib/trading";

/** The account wallet's on-chain token holdings, priced. Never exposes keys. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const holdings = await getAccountHoldings(user.id);

    // Attribute each token to the basket that bought it, so the wallet reads
    // as index positions rather than a pile of loose coins. Cosmetic only —
    // never fail the holdings read over it.
    try {
      const rows = getDb()
        .prepare(
          `SELECT h.mint, b.id AS basketId, b.name AS basketName
           FROM holdings h JOIN baskets b ON b.id = h.basket_id
           WHERE h.user_id = ? AND h.qty > 0`
        )
        .all(user.id) as { mint: string; basketId: number; basketName: string }[];
      const byMint = new Map(rows.map((r) => [r.mint, r]));
      for (const t of holdings.tokens) {
        const hit = byMint.get(t.mint);
        Object.assign(t, {
          basketId: hit?.basketId ?? null,
          basketName: hit?.basketName ?? null,
        });
      }
    } catch {
      /* attribution is optional */
    }

    return NextResponse.json({ holdings });
  } catch (e) {
    if (e instanceof TradingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("holdings failed", e);
    return NextResponse.json({ error: "Couldn't load holdings" }, { status: 500 });
  }
}
