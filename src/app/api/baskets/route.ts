import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isCurated } from "@/lib/tokens";
import { CREATION_FEE_SOL, TreasuryError, chargeCreationFee } from "@/lib/treasury";
import {
  basketChange24h,
  getBasketTokens,
  getBasketTraders,
  investorCount,
  listBaskets,
} from "@/lib/portfolio";

export async function GET() {
  const user = await getUser();
  const baskets = listBaskets(user?.id ?? null);
  const enriched = await Promise.all(
    baskets.map(async (b) => ({
      ...b,
      tokens: b.kind === "coin" ? getBasketTokens(b.id) : [],
      traders: b.kind === "trader" ? getBasketTraders(b.id) : [],
      change24h: await basketChange24h(b),
      investors: investorCount(b.id),
      mine: user != null && b.owner_id === user.id,
    }))
  );
  return NextResponse.json({ baskets: enriched });
}

type CreateBody = {
  kind?: "coin" | "trader";
  name?: string;
  description?: string;
  emoji?: string;
  horizon?: "short" | "long" | null;
  isPublic?: boolean;
  tokens?: { mint: string; weight: number }[];
  traders?: { id: number; weight: number }[];
};

// Any token Jupiter can find AND price is basket-eligible — bonded or still on
// the bonding curve. The price requirement matters: the creation fee is charged
// before the basket exists, so an unpriceable mint would sell a basket that can
// never trade.
async function verifyUnknownMint(mint: string): Promise<
  | { ok: true; symbol: string; name: string; icon: string | null; decimals: number }
  | { ok: false; reason: string }
> {
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) return { ok: false, reason: "couldn't be found on Jupiter" };
    const list = (await res.json()) as Array<{
      id: string; symbol?: string; name?: string; decimals?: number;
      usdPrice?: number; icon?: string;
    }>;
    const t = list?.find((x) => x.id === mint);
    if (!t) return { ok: false, reason: "couldn't be found on Jupiter" };
    if (!((t.usdPrice ?? 0) > 0)) {
      return { ok: false, reason: "has no live price, so it can't be bought or valued" };
    }
    return {
      ok: true,
      symbol: (t.symbol ?? "?").trim(),
      name: (t.name ?? "Unknown").trim(),
      // Jupiter's own icon when it has one; DexScreener's CDN as fallback
      icon: t.icon || `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png?size=lg`,
      decimals: t.decimals ?? 6,
    };
  } catch {
    return { ok: false, reason: "couldn't be verified right now — try again" };
  }
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const kind = body.kind === "trader" ? "trader" : "coin";
  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim().slice(0, 300);
  const emoji = (body.emoji ?? "🧺").slice(0, 8);
  const horizon = body.horizon === "short" || body.horizon === "long" ? body.horizon : null;
  const isPublic = body.isPublic !== false;

  if (name.length < 3 || name.length > 40) {
    return NextResponse.json({ error: "Name must be 3-40 characters" }, { status: 400 });
  }

  const db = getDb();

  if (kind === "coin") {
    const raw = (body.tokens ?? []).filter((t) => t && typeof t.mint === "string");
    // Reject zero weights loudly instead of silently dropping them — the
    // builder showed that token as included, so quietly omitting it would
    // create a different basket than the one the user reviewed.
    if (raw.some((t) => !Number.isFinite(t.weight) || t.weight <= 0)) {
      return NextResponse.json(
        { error: "Every token needs a weight above 0%" },
        { status: 400 }
      );
    }
    const items = raw;
    if (items.length < 2 || items.length > 10) {
      return NextResponse.json({ error: "Pick between 2 and 10 tokens" }, { status: 400 });
    }
    const mints = new Set(items.map((t) => t.mint));
    if (mints.size !== items.length) {
      return NextResponse.json({ error: "Duplicate tokens in basket" }, { status: 400 });
    }
    const total = items.reduce((s, t) => s + t.weight, 0);
    if (Math.abs(total - 100) > 1) {
      return NextResponse.json({ error: "Weights must add up to 100%" }, { status: 400 });
    }

    // any non-curated mint must be a verified token on Jupiter; cache its metadata
    for (const t of items) {
      if (isCurated(t.mint)) continue;
      const known = db.prepare("SELECT mint FROM token_meta WHERE mint = ?").get(t.mint);
      if (known) continue;
      const meta = await verifyUnknownMint(t.mint);
      if (!meta.ok) {
        return NextResponse.json(
          { error: `Token ${t.mint.slice(0, 8)}… ${meta.reason}` },
          { status: 400 }
        );
      }
      db.prepare(
        "INSERT OR IGNORE INTO token_meta (mint, symbol, name, icon, decimals, coingecko_id, tracked) VALUES (?, ?, ?, ?, ?, NULL, 0)"
      ).run(t.mint, meta.symbol, meta.name, meta.icon, meta.decimals);
    }

    // Basket + its tokens go in ONE transaction, BEFORE any money moves. A
    // half-written basket must never exist, and the irreversible on-chain fee
    // must never be charged for a basket that failed to save.
    let basketId: number;
    db.exec("BEGIN");
    try {
      const res = db
        .prepare(
          "INSERT INTO baskets (owner_id, kind, name, description, emoji, horizon, is_public, created_at) VALUES (?, 'coin', ?, ?, ?, ?, ?, ?)"
        )
        .run(user.id, name, description, emoji, horizon, isPublic ? 1 : 0, Date.now());
      basketId = Number(res.lastInsertRowid);
      for (const t of items) {
        db.prepare("INSERT INTO basket_tokens (basket_id, mint, weight) VALUES (?, ?, ?)").run(
          basketId,
          t.mint,
          t.weight / total
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      console.error("basket insert failed", e);
      return NextResponse.json({ error: "Could not save the basket" }, { status: 500 });
    }

    let feeCoin: { sol: number; usd: number; signature: string | null; waived: boolean };
    try {
      feeCoin = await chargeCreationFee(user.id, name, basketId);
    } catch (e) {
      // Fee failed — undo the basket so the user is never left with an
      // unpaid-for basket or an unexplained charge.
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM basket_tokens WHERE basket_id = ?").run(basketId);
        db.prepare("DELETE FROM baskets WHERE id = ?").run(basketId);
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
      }
      return NextResponse.json(
        { error: e instanceof TreasuryError ? e.message : "Could not charge the creation fee" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, id: basketId, fee: feeCoin });
  }

  // trader basket
  const rawTraders = (body.traders ?? []).filter((t) => t && Number.isInteger(t.id));
  if (rawTraders.some((t) => !Number.isFinite(t.weight) || t.weight <= 0)) {
    return NextResponse.json(
      { error: "Every trader needs a weight above 0%" },
      { status: 400 }
    );
  }
  const items = rawTraders;
  if (items.length < 2 || items.length > 10) {
    return NextResponse.json({ error: "Pick between 2 and 10 traders" }, { status: 400 });
  }
  const ids = new Set(items.map((t) => t.id));
  if (ids.size !== items.length) {
    return NextResponse.json({ error: "Duplicate traders in basket" }, { status: 400 });
  }
  const total = items.reduce((s, t) => s + t.weight, 0);
  if (Math.abs(total - 100) > 1) {
    return NextResponse.json({ error: "Weights must add up to 100%" }, { status: 400 });
  }
  for (const t of items) {
    const exists = db.prepare("SELECT id FROM traders WHERE id = ?").get(t.id);
    if (!exists) return NextResponse.json({ error: "Unknown trader in basket" }, { status: 400 });
  }

  let basketId: number;
  db.exec("BEGIN");
  try {
    const res = db
      .prepare(
        "INSERT INTO baskets (owner_id, kind, name, description, emoji, horizon, is_public, created_at) VALUES (?, 'trader', ?, ?, ?, ?, ?, ?)"
      )
      .run(user.id, name, description, emoji, horizon, isPublic ? 1 : 0, Date.now());
    basketId = Number(res.lastInsertRowid);
    for (const t of items) {
      db.prepare("INSERT INTO basket_traders (basket_id, trader_id, weight) VALUES (?, ?, ?)").run(
        basketId,
        t.id,
        t.weight / total
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error("basket insert failed", e);
    return NextResponse.json({ error: "Could not save the basket" }, { status: 500 });
  }

  let feeTrader: { sol: number; usd: number; signature: string | null; waived: boolean };
  try {
    feeTrader = await chargeCreationFee(user.id, name, basketId);
  } catch (e) {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM basket_traders WHERE basket_id = ?").run(basketId);
      db.prepare("DELETE FROM baskets WHERE id = ?").run(basketId);
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }
    return NextResponse.json(
      { error: e instanceof TreasuryError ? e.message : "Could not charge the creation fee" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, id: basketId, fee: feeTrader });
}
