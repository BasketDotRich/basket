import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureWalletRefresher } from "@/lib/wallets";

// Position changes detected between wallet snapshots (~5 min resolution).
export async function GET() {
  ensureWalletRefresher();
  const db = getDb();
  const events = db
    .prepare(
      `SELECT e.id, e.ts, e.mint, e.symbol, e.delta_usd, e.kind,
              t.id AS trader_id, t.name, t.pfp, t.listed
       FROM wallet_events e JOIN traders t ON t.id = e.trader_id
       ORDER BY e.ts DESC, e.id DESC LIMIT 40`
    )
    .all();
  return NextResponse.json({ events });
}
