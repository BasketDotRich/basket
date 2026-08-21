import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  HELIUS_WEBHOOK_SECRET,
  parseTrades,
  recordDetectedTrade,
  type HeliusTx,
} from "@/lib/helius-webhook";
import { getPrices } from "@/lib/prices";
import { invalidateWallet, mintSymbol } from "@/lib/wallets";

export const dynamic = "force-dynamic";

/**
 * Helius pushes parsed SWAP transactions here within a second or two of them
 * landing. This is what makes copy-trading near-instant instead of waiting on
 * a 5-minute balance sweep.
 *
 * Answers 200 fast and unconditionally after auth: Helius retries non-2xx, and
 * a retry storm on a slow tick would be worse than a missed event — the
 * snapshot sweep re-detects anything dropped.
 */
export async function POST(req: Request) {
  // Fail closed when a secret is configured; Helius sends it as `authorization`.
  if (HELIUS_WEBHOOK_SECRET) {
    const got = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (got !== HELIUS_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let body: HeliusTx[] | { transactions?: HeliusTx[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const txs: HeliusTx[] = Array.isArray(body) ? body : (body.transactions ?? []);
  if (txs.length === 0) return NextResponse.json({ ok: true, trades: 0 });

  try {
    const db = getDb();
    const traders = db
      .prepare("SELECT id, wallet FROM traders WHERE wallet IS NOT NULL")
      .all() as { id: number; wallet: string }[];
    const idByWallet = new Map(traders.map((t) => [t.wallet, t.id]));
    const tracked = new Set(idByWallet.keys());

    const trades = txs.flatMap((tx) => parseTrades(tx, tracked));
    if (trades.length === 0) return NextResponse.json({ ok: true, trades: 0 });

    // Price the traded mints so the event carries a real USD size.
    const prices = await getPrices([...new Set(trades.map((t) => t.mint))]);

    let recorded = 0;
    const touched = new Set<string>();
    for (const t of trades) {
      const traderId = idByWallet.get(t.wallet);
      if (traderId == null) continue;
      const px = prices[t.mint]?.usdPrice ?? 0;
      if (recordDetectedTrade(t, traderId, mintSymbol(t.mint), t.amount * px)) recorded++;
      touched.add(t.wallet);
    }

    // Drop the cached balance for every wallet that just traded, so the very
    // next mirror reads fresh on-chain state instead of a stale snapshot.
    for (const w of touched) invalidateWallet(w);

    // A tracked wallet just moved: re-mirror every allocation that follows a
    // basket containing it. This is what makes copy-trading near-instant
    // rather than waiting for the next sweep.
    if (touched.size > 0 && process.env.MIRROR_ENGINE_ENABLED === "1") {
      try {
        const { activeAllocations, syncSquadMirror } = await import("@/lib/mirror");
        const affected = db
          .prepare(
            `SELECT DISTINCT bt.basket_id FROM basket_traders bt
             JOIN traders t ON t.id = bt.trader_id
             WHERE t.wallet IN (${[...touched].map(() => "?").join(",")})`
          )
          .all(...touched) as { basket_id: number }[];
        const ids = new Set(affected.map((a) => a.basket_id));
        for (const a of activeAllocations()) {
          if (!ids.has(a.basket_id)) continue;
          syncSquadMirror(a.user_id, a.basket_id).catch(() => {});
        }
      } catch {
        // mirroring is best-effort here; the 60s tick still catches it
      }
    }

    return NextResponse.json({ ok: true, trades: recorded, wallets: touched.size });
  } catch (e) {
    console.error("[helius webhook] failed", e);
    return NextResponse.json({ ok: true, error: "handled" });
  }
}
