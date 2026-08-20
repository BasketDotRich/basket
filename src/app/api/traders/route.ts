import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";
import type { TraderRow } from "@/lib/portfolio";
import {
  ensureWalletRefresher,
  getTraderReturn,
  getWalletValue,
  getWalletValueCached,
  snapshotTrader,
} from "@/lib/wallets";

const DAY = 24 * 3600_000;

export async function GET() {
  // The refresher sweeps all wallets in the background (~1.5s apart); this
  // route reads cache-only so a 98-wallet roster stays instant.
  ensureWalletRefresher();
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, name, wallet, label, bio, twitter, pfp, listed, source_url, seed_stats, created_at FROM traders ORDER BY id ASC"
    )
    .all() as (TraderRow & {
    twitter: string | null;
    pfp: string | null;
    listed: number;
    created_at: number;
  })[];

  const traders = rows.map((t) => {
    const value = getWalletValueCached(t.wallet);
    return {
      id: t.id,
      name: t.name,
      wallet: t.wallet,
      label: t.label,
      bio: t.bio,
      twitter: t.twitter,
      pfp: t.pfp,
      listed: t.listed === 1,
      sourceUrl: t.source_url,
      seedStats: t.seed_stats ? JSON.parse(t.seed_stats) : null,
      trackedSince: t.created_at,
      valueUsd: value?.totalUsd ?? null,
      solAmount: value?.solAmount ?? null,
      ret24h: getTraderReturn(t.id, DAY),
      ret7d: getTraderReturn(t.id, 7 * DAY),
    };
  });
  return NextResponse.json({ traders });
}

// Add any Solana wallet to the tracked roster. Tracking starts immediately —
// value history is real on-chain data from this moment forward.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { name?: string; wallet?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const wallet = (body.wallet ?? "").trim();
  const name = (body.name ?? "").trim() || `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return NextResponse.json({ error: "Enter a valid Solana wallet address" }, { status: 400 });
  }
  if (name.length > 30) {
    return NextResponse.json({ error: "Name too long (max 30)" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM traders WHERE wallet = ?").get(wallet) as
    | { id: number }
    | undefined;
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, existed: true });
  }

  // verify the wallet actually resolves on-chain before adding
  const value = await getWalletValue(wallet);
  if (!value) {
    return NextResponse.json(
      { error: "Could not read this wallet on-chain — check the address" },
      { status: 400 }
    );
  }

  const res = db
    .prepare(
      "INSERT INTO traders (name, wallet, label, bio, source_url, seed_stats, added_by, created_at) VALUES (?, ?, 'community', 'Community-added wallet.', NULL, NULL, ?, ?)"
    )
    .run(name, wallet, user.id, Date.now());
  const id = Number(res.lastInsertRowid);
  await snapshotTrader(id, wallet);
  return NextResponse.json({ ok: true, id });
}
