import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getMarketStats, getPrices } from "@/lib/prices";
import {
  getTraderBasketNavLive,
  getTraderReturn,
  getUniverseMints,
  getWalletValue,
  mintSymbol,
} from "@/lib/wallets";
import {
  basketChange24h,
  getBasket,
  getBasketTokens,
  getBasketTraders,
  investorCount,
} from "@/lib/portfolio";

const DAY = 24 * 3600_000;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const basketId = Number(id);
  const basket = getBasket(basketId);
  if (!basket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const user = await getUser();
  if (!basket.is_public && basket.owner_id !== user?.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDb();
  const myRule = user
    ? ((db
        .prepare(
          "SELECT tp_pct, sl_pct, close_at FROM position_rules WHERE user_id = ? AND basket_id = ?"
        )
        .get(user.id, basketId) as
        | { tp_pct: number | null; sl_pct: number | null; close_at: number | null }
        | undefined) ?? null)
    : null;
  const base = {
    ...basket,
    mine: user != null && basket.owner_id === user.id,
    investors: investorCount(basket.id),
    change24h: await basketChange24h(basket),
    myRule,
  };

  if (basket.kind === "coin") {
    const tokens = getBasketTokens(basketId);
    const [prices, mktStats] = await Promise.all([
      getPrices(tokens.map((t) => t.mint)),
      getMarketStats(tokens.map((t) => t.mint)),
    ]);
    const myHoldings = user
      ? (db
          .prepare("SELECT mint, qty, cost FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0")
          .all(user.id, basketId) as { mint: string; qty: number; cost: number }[])
      : [];
    const holdingsByMint = new Map(myHoldings.map((h) => [h.mint, h]));
    let myValue = 0;
    let myCost = 0;
    const tokenRows = tokens.map((t) => {
      const p = prices[t.mint];
      const h = holdingsByMint.get(t.mint);
      const value = h && p ? h.qty * p.usdPrice : 0;
      myValue += value;
      myCost += h?.cost ?? 0;
      const st = mktStats[t.mint];
      return {
        ...t,
        price: p?.usdPrice ?? null,
        change24h: p?.priceChange24h ?? null,
        mcap: st?.mcap ?? null,
        volume24h: st?.volume24h ?? null,
        liquidity: st?.liquidity ?? null,
        myQty: h?.qty ?? 0,
        myValue: value,
      };
    });

    // Basket-level rollup. Liquidity is the one that decides whether you can
    // actually GET OUT, so it is reported as the thinnest leg (the true
    // bottleneck) rather than a flattering sum, alongside the total.
    const liqs = tokenRows.map((t) => t.liquidity).filter((v): v is number => v != null && v > 0);
    const stats = {
      mcap: tokenRows.reduce((s, t) => s + (t.mcap ?? 0), 0) || null,
      volume24h: tokenRows.reduce((s, t) => s + (t.volume24h ?? 0), 0) || null,
      liquidity: liqs.length ? liqs.reduce((s, v) => s + v, 0) : null,
      thinnestLeg:
        liqs.length === tokenRows.length && liqs.length > 0
          ? tokenRows.reduce((lo, t) => ((t.liquidity ?? Infinity) < (lo.liquidity ?? Infinity) ? t : lo))
          : null,
      coverage: tokenRows.length ? liqs.length / tokenRows.length : 0,
    };

    return NextResponse.json({
      basket: { ...base, tokens: tokenRows, myValue, myCost, stats },
    });
  }

  // trader basket: live on-chain data per member wallet
  const memberRows = getBasketTraders(basketId);
  await getUniverseMints(); // warm the mint→symbol map before labeling holdings
  const traders = await Promise.all(
    memberRows.map(async (t) => {
      const value = await getWalletValue(t.wallet).catch(() => null);
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
        weight: t.weight,
        valueUsd: value?.totalUsd ?? null,
        solAmount: value?.solAmount ?? null,
        ret24h: getTraderReturn(t.id, DAY),
        topHoldings: (value?.holdings ?? []).slice(0, 4).map((h) => ({
          symbol: mintSymbol(h.mint),
          valueUsd: h.valueUsd,
        })),
      };
    })
  );
  const nav = await getTraderBasketNavLive(basketId);
  const mine = user
    ? (db
        .prepare("SELECT units, cost FROM trader_holdings WHERE user_id = ? AND basket_id = ?")
        .get(user.id, basketId) as { units: number; cost: number } | undefined)
    : undefined;
  return NextResponse.json({
    basket: {
      ...base,
      traders,
      nav,
      myUnits: mine?.units ?? 0,
      myValue: (mine?.units ?? 0) * nav,
      myCost: mine?.cost ?? 0,
    },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const basketId = Number(id);
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const basket = getBasket(basketId);
  if (!basket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (basket.owner_id !== user.id) {
    return NextResponse.json({ error: "Only the owner can delete a basket" }, { status: 403 });
  }
  if (investorCount(basketId) > 0) {
    return NextResponse.json(
      { error: "Basket still has investors — everyone must redeem first" },
      { status: 400 }
    );
  }
  const db = getDb();
  db.prepare("DELETE FROM basket_tokens WHERE basket_id = ?").run(basketId);
  db.prepare("DELETE FROM basket_traders WHERE basket_id = ?").run(basketId);
  db.prepare("DELETE FROM baskets WHERE id = ?").run(basketId);
  return NextResponse.json({ ok: true });
}
