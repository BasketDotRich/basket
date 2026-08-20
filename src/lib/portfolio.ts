import { getDb } from "./db";
import { getPrices } from "./prices";
import { takePerformanceFee } from "./treasury";
import {
  ensureWalletRefresher,
  getTraderBasketNavLive,
  getTraderReturn,
} from "./wallets";

export type BasketRow = {
  id: number;
  owner_id: number;
  kind: "coin" | "trader";
  name: string;
  description: string;
  emoji: string;
  horizon: "short" | "long" | null;
  is_public: number;
  created_at: number;
  owner_name?: string;
};

export type TokenMetaRow = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  coingecko_id: string | null;
};

export type TraderRow = {
  id: number;
  name: string;
  wallet: string;
  label: string;
  bio: string;
  twitter: string | null;
  pfp: string | null;
  listed: number;
  source_url: string | null;
  seed_stats: string | null;
};

export function getBasket(id: number): BasketRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT b.*, u.username AS owner_name FROM baskets b JOIN users u ON u.id = b.owner_id WHERE b.id = ?`
    )
    .get(id) as BasketRow | undefined;
  return row ?? null;
}

export function getBasketTokens(basketId: number): (TokenMetaRow & { weight: number })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT tm.*, bt.weight FROM basket_tokens bt
       JOIN token_meta tm ON tm.mint = bt.mint
       WHERE bt.basket_id = ? ORDER BY bt.weight DESC`
    )
    .all(basketId) as (TokenMetaRow & { weight: number })[];
}

export function getBasketTraders(basketId: number): (TraderRow & { weight: number })[] {
  const db = getDb();
  ensureWalletRefresher();
  return db
    .prepare(
      `SELECT t.id, t.name, t.wallet, t.label, t.bio, t.twitter, t.pfp, t.listed, t.source_url, t.seed_stats, bt.weight
       FROM basket_traders bt
       JOIN traders t ON t.id = bt.trader_id
       WHERE bt.basket_id = ? ORDER BY bt.weight DESC`
    )
    .all(basketId) as (TraderRow & { weight: number })[];
}

export function listBaskets(userId: number | null): BasketRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT b.*, u.username AS owner_name FROM baskets b
       JOIN users u ON u.id = b.owner_id
       WHERE b.is_public = 1 OR b.owner_id = ?
       ORDER BY b.created_at ASC, b.id ASC`
    )
    .all(userId ?? -1) as BasketRow[];
}

export function investorCount(basketId: number): number {
  const db = getDb();
  const a = db
    .prepare("SELECT COUNT(DISTINCT user_id) AS n FROM holdings WHERE basket_id = ? AND qty > 0")
    .get(basketId) as { n: number };
  const b = db
    .prepare("SELECT COUNT(*) AS n FROM trader_holdings WHERE basket_id = ? AND units > 0")
    .get(basketId) as { n: number };
  return a.n + b.n;
}

/** Weighted 24h performance. Trader baskets need ≥24h of real snapshots; null until then. */
export async function basketChange24h(basket: BasketRow): Promise<number | null> {
  if (basket.kind === "coin") {
    const tokens = getBasketTokens(basket.id);
    const prices = await getPrices(tokens.map((t) => t.mint));
    let acc = 0;
    let w = 0;
    for (const t of tokens) {
      const ch = prices[t.mint]?.priceChange24h;
      if (ch != null) {
        acc += t.weight * ch;
        w += t.weight;
      }
    }
    return w > 0 ? acc / w : null;
  }
  const traders = getBasketTraders(basket.id);
  let acc = 0;
  let w = 0;
  for (const t of traders) {
    const ret = getTraderReturn(t.id, 24 * 3600_000);
    if (ret != null) {
      acc += t.weight * ret;
      w += t.weight;
    }
  }
  return w > 0 ? acc / w : null;
}

// ---------- investing ----------

export class InvestError extends Error {}

const PRICE_MAX_STALE_MS = 5 * 60_000; // trades never execute on prices older than this

/** Debit cash atomically; throws if the balance no longer covers the amount. */
function debitCashGuarded(userId: number, amount: number): void {
  const r = getDb()
    .prepare("UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ? - 1e-9")
    .run(amount, userId, amount);
  if (r.changes === 0) throw new InvestError("Insufficient balance — add funds first");
}

export async function investInBasket(userId: number, basketId: number, amount: number): Promise<void> {
  ensureRulesEngine();
  const db = getDb();
  const basket = getBasket(basketId);
  if (!basket || (!basket.is_public && basket.owner_id !== userId)) {
    throw new InvestError("Basket not found");
  }
  if (!Number.isFinite(amount) || amount < 1) throw new InvestError("Minimum investment is $1");

  const user = db.prepare("SELECT cash FROM users WHERE id = ?").get(userId) as { cash: number };
  if (user.cash < amount - 1e-9) throw new InvestError("Insufficient balance — add funds first");

  if (basket.kind === "coin") {
    const tokens = getBasketTokens(basketId);
    if (tokens.length === 0) throw new InvestError("Basket has no tokens");
    const prices = await getPrices(tokens.map((t) => t.mint), { maxStaleMs: PRICE_MAX_STALE_MS });
    for (const t of tokens) {
      if (!prices[t.mint] || prices[t.mint].usdPrice <= 0) {
        throw new InvestError(`Live price unavailable for ${t.symbol} — try again shortly`);
      }
    }
    db.exec("BEGIN");
    try {
      for (const t of tokens) {
        const usd = amount * t.weight;
        const qty = usd / prices[t.mint].usdPrice;
        db.prepare(
          `INSERT INTO holdings (user_id, basket_id, mint, qty, cost) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, basket_id, mint) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost`
        ).run(userId, basketId, t.mint, qty, usd);
      }
      debitCashGuarded(userId, amount);
      db.prepare(
        "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'invest', ?, ?, ?, ?)"
      ).run(userId, basketId, amount, `Invested in ${basket.name}`, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } else {
    let nav: number;
    try {
      nav = await getTraderBasketNavLive(basket.id, { strict: true });
    } catch {
      throw new InvestError("NAV data temporarily unavailable — try again shortly");
    }
    if (!Number.isFinite(nav) || nav <= 0) throw new InvestError("NAV unavailable — try again shortly");
    const units = amount / nav;
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO trader_holdings (user_id, basket_id, units, cost) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, basket_id) DO UPDATE SET units = units + excluded.units, cost = cost + excluded.cost`
      ).run(userId, basketId, units, amount);
      debitCashGuarded(userId, amount);
      db.prepare(
        "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'invest', ?, ?, ?, ?)"
      ).run(userId, basketId, amount, `Invested in ${basket.name} @ NAV ${nav.toFixed(2)}`, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  await recordSnapshot(userId, true);
}

/**
 * Thrown when some basket legs have no live price. Carries the symbols so the
 * caller can offer an explicit write-off instead of locking the position —
 * without this, one dead token would make a whole basket unredeemable forever.
 */
export class UnpricedLegsError extends InvestError {
  constructor(public symbols: string[]) {
    super(`No live price for ${symbols.join(", ")}`);
  }
}

export async function redeemFromBasket(
  userId: number,
  basketId: number,
  fraction: number,
  note?: string,
  opts: { allowUnpriced?: boolean } = {}
): Promise<number> {
  const db = getDb();
  const basket = getBasket(basketId);
  if (!basket) throw new InvestError("Basket not found");
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new InvestError("Fraction must be between 0 and 1");
  }

  // All async pricing happens BEFORE the transaction; the authoritative position
  // read happens INSIDE it, so concurrent redeems can never double-pay.
  let proceeds = 0;
  let fee = 0;
  let net = 0;
  if (basket.kind === "coin") {
    const mintRows = db
      .prepare("SELECT mint FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0")
      .all(userId, basketId) as { mint: string }[];
    if (mintRows.length === 0) {
      if (!basket.is_public && basket.owner_id !== userId) throw new InvestError("Basket not found");
      throw new InvestError("Nothing to redeem in this basket");
    }
    const prices = await getPrices(mintRows.map((r) => r.mint), { maxStaleMs: PRICE_MAX_STALE_MS });
    db.exec("BEGIN");
    try {
      const rows = db
        .prepare("SELECT mint, qty, cost FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0")
        .all(userId, basketId) as { mint: string; qty: number; cost: number }[];
      if (rows.length === 0) throw new InvestError("Nothing to redeem in this basket");
      const unpriced = rows.filter((r) => !prices[r.mint] || prices[r.mint].usdPrice <= 0);
      if (unpriced.length > 0 && !opts.allowUnpriced) {
        const meta = db.prepare("SELECT mint, symbol FROM token_meta").all() as {
          mint: string; symbol: string;
        }[];
        const symbolOf = new Map(meta.map((m) => [m.mint, m.symbol]));
        throw new UnpricedLegsError(
          unpriced.map((r) => symbolOf.get(r.mint) ?? `${r.mint.slice(0, 4)}…`)
        );
      }
      let costRedeemed = 0;
      for (const r of rows) {
        costRedeemed += r.cost * fraction;
        // unpriced legs are written off at $0 (explicitly consented above)
        proceeds += r.qty * fraction * (prices[r.mint]?.usdPrice ?? 0);
        if (fraction >= 0.9999) {
          db.prepare("DELETE FROM holdings WHERE user_id = ? AND basket_id = ? AND mint = ?").run(
            userId, basketId, r.mint
          );
        } else {
          db.prepare(
            "UPDATE holdings SET qty = qty * ?, cost = cost * ? WHERE user_id = ? AND basket_id = ? AND mint = ?"
          ).run(1 - fraction, 1 - fraction, userId, basketId, r.mint);
        }
      }
      if (fraction >= 0.9999) {
        // exit rules belong to the position, not the basket — retire them with it
        db.prepare("DELETE FROM position_rules WHERE user_id = ? AND basket_id = ?").run(userId, basketId);
      }
      fee = takePerformanceFee({
        userId, basketId, basketName: basket.name, proceeds, costRedeemed,
      });
      net = proceeds - fee;
      db.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").run(net, userId);
      db.prepare(
        "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'redeem', ?, ?, ?, ?)"
      ).run(
        userId, basketId, net,
        (note ?? `Redeemed ${(fraction * 100).toFixed(0)}% of ${basket.name}`) +
          (fee > 0 ? ` · $${fee.toFixed(2)} performance fee → burn treasury` : ""),
        Date.now()
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } else {
    const exists = db
      .prepare("SELECT units FROM trader_holdings WHERE user_id = ? AND basket_id = ? AND units > 0")
      .get(userId, basketId) as { units: number } | undefined;
    if (!exists) {
      if (!basket.is_public && basket.owner_id !== userId) throw new InvestError("Basket not found");
      throw new InvestError("Nothing to redeem in this basket");
    }
    let nav: number;
    try {
      nav = await getTraderBasketNavLive(basket.id, { strict: true });
    } catch {
      throw new InvestError("NAV data temporarily unavailable — try again shortly");
    }
    db.exec("BEGIN");
    try {
      const row = db
        .prepare("SELECT units, cost FROM trader_holdings WHERE user_id = ? AND basket_id = ? AND units > 0")
        .get(userId, basketId) as { units: number; cost: number } | undefined;
      if (!row) throw new InvestError("Nothing to redeem in this basket");
      proceeds = row.units * fraction * nav;
      const costRedeemed = row.cost * fraction;
      if (fraction >= 0.9999) {
        db.prepare("DELETE FROM trader_holdings WHERE user_id = ? AND basket_id = ?").run(userId, basketId);
        db.prepare("DELETE FROM position_rules WHERE user_id = ? AND basket_id = ?").run(userId, basketId);
      } else {
        db.prepare(
          "UPDATE trader_holdings SET units = units * ?, cost = cost * ? WHERE user_id = ? AND basket_id = ?"
        ).run(1 - fraction, 1 - fraction, userId, basketId);
      }
      fee = takePerformanceFee({
        userId, basketId, basketName: basket.name, proceeds, costRedeemed,
      });
      net = proceeds - fee;
      db.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").run(net, userId);
      db.prepare(
        "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'redeem', ?, ?, ?, ?)"
      ).run(
        userId, basketId, net,
        (note ?? `Redeemed ${(fraction * 100).toFixed(0)}% of ${basket.name}`) +
          (fee > 0 ? ` · $${fee.toFixed(2)} performance fee → burn treasury` : ""),
        Date.now()
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  await recordSnapshot(userId, true);
  return net;
}

// ---------- exit-rule automation (take-profit / stop-loss / auto-close) ----------

export type ExitRule = {
  tp_pct: number | null;
  sl_pct: number | null;
  close_at: number | null;
};

/**
 * Set exit rules. Semantics are explicit so a partial arm can't silently wipe
 * the rest: `undefined` = leave the stored value alone, `null` = clear that
 * field, a number = set it. Out-of-range numbers are rejected, never coerced
 * to "clear" — that would disarm a stop-loss while reporting success.
 */
export function setPositionRule(
  userId: number,
  basketId: number,
  rule: { tpPct?: number | null; slPct?: number | null; closeDays?: number | null },
  opts: { dryRun?: boolean } = {}
): void {
  const db = getDb();
  const inRange = (v: number | null | undefined, lo: number, hi: number, label: string) => {
    if (v === undefined || v === null) return v;
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new InvestError(`${label} must be between ${lo} and ${hi}`);
    }
    return v;
  };
  const tpIn = inRange(rule.tpPct, 5, 1000, "Take-profit %");
  const slIn = inRange(rule.slPct, 5, 95, "Stop-loss %");
  const daysIn = inRange(rule.closeDays, 1, 365, "Auto-close days");
  if (opts.dryRun) return; // validation only — nothing written

  const existing = db
    .prepare("SELECT tp_pct, sl_pct, close_at FROM position_rules WHERE user_id = ? AND basket_id = ?")
    .get(userId, basketId) as ExitRule | undefined;

  const tp = tpIn === undefined ? (existing?.tp_pct ?? null) : tpIn;
  const sl = slIn === undefined ? (existing?.sl_pct ?? null) : slIn;
  const closeAt =
    daysIn === undefined
      ? (existing?.close_at ?? null)
      : daysIn === null
        ? null
        : Date.now() + daysIn * 86_400_000;

  if (tp == null && sl == null && closeAt == null) {
    db.prepare("DELETE FROM position_rules WHERE user_id = ? AND basket_id = ?").run(userId, basketId);
    return;
  }
  db.prepare(
    `INSERT INTO position_rules (user_id, basket_id, tp_pct, sl_pct, close_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, basket_id) DO UPDATE SET tp_pct=excluded.tp_pct, sl_pct=excluded.sl_pct, close_at=excluded.close_at`
  ).run(userId, basketId, tp, sl, closeAt, Date.now());
}

export function clearPositionRule(userId: number, basketId: number): void {
  getDb().prepare("DELETE FROM position_rules WHERE user_id = ? AND basket_id = ?").run(userId, basketId);
}

/** True only when the user genuinely holds nothing in this basket. */
function positionExists(userId: number, basketId: number): boolean {
  const db = getDb();
  const coin = db
    .prepare("SELECT 1 FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0 LIMIT 1")
    .get(userId, basketId);
  if (coin) return true;
  const trader = db
    .prepare("SELECT 1 FROM trader_holdings WHERE user_id = ? AND basket_id = ? AND units > 0 LIMIT 1")
    .get(userId, basketId);
  return !!trader;
}

async function positionValueAndCost(userId: number, basketId: number): Promise<{ value: number; cost: number } | null> {
  const db = getDb();
  const basket = getBasket(basketId);
  if (!basket) return null;
  if (basket.kind === "coin") {
    const rows = db
      .prepare("SELECT mint, qty, cost FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0")
      .all(userId, basketId) as { mint: string; qty: number; cost: number }[];
    if (rows.length === 0) return null;
    const prices = await getPrices(rows.map((r) => r.mint), { maxStaleMs: PRICE_MAX_STALE_MS });
    let value = 0;
    let cost = 0;
    for (const r of rows) {
      const p = prices[r.mint]?.usdPrice;
      if (!p || p <= 0) return null; // can't judge the rule without live prices
      value += r.qty * p;
      cost += r.cost;
    }
    return { value, cost };
  }
  const row = db
    .prepare("SELECT units, cost FROM trader_holdings WHERE user_id = ? AND basket_id = ? AND units > 0")
    .get(userId, basketId) as { units: number; cost: number } | undefined;
  if (!row) return null;
  try {
    const nav = await getTraderBasketNavLive(basketId, { strict: true });
    return { value: row.units * nav, cost: row.cost };
  } catch {
    return null;
  }
}

/** One pass over all armed rules; triggers auto-redeem at live valuations. */
export async function checkExitRules(): Promise<void> {
  const db = getDb();
  const rules = db
    .prepare("SELECT user_id, basket_id, tp_pct, sl_pct, close_at FROM position_rules")
    .all() as (ExitRule & { user_id: number; basket_id: number })[];
  for (const r of rules) {
    // Retire the rule ONLY when the position is actually gone. A pricing
    // outage must never silently disarm someone's stop-loss.
    if (!positionExists(r.user_id, r.basket_id)) {
      clearPositionRule(r.user_id, r.basket_id);
      continue;
    }
    const pos = await positionValueAndCost(r.user_id, r.basket_id);
    if (!pos || pos.cost <= 0) continue; // can't value it right now — retry next pass
    const pnlPct = (pos.value / pos.cost - 1) * 100;
    let reason: string | null = null;
    if (r.tp_pct != null && pnlPct >= r.tp_pct) {
      reason = `Take-profit hit at ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
    } else if (r.sl_pct != null && pnlPct <= -r.sl_pct) {
      reason = `Stop-loss hit at ${pnlPct.toFixed(1)}%`;
    } else if (r.close_at != null && Date.now() >= r.close_at) {
      reason = `Timed exit at ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
    }
    if (!reason) continue;
    try {
      const basket = getBasket(r.basket_id);
      await redeemFromBasket(r.user_id, r.basket_id, 1, `${reason} — auto-redeemed ${basket?.name ?? "basket"}`);
      clearPositionRule(r.user_id, r.basket_id);
    } catch {
      // live data hiccup — leave the rule armed; next pass retries
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __bRulesEngine: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __bRulesBusy: boolean | undefined;
}

/** Checks armed exit rules every minute while the server runs. */
export function ensureRulesEngine(): void {
  if (globalThis.__bRulesEngine) return;
  globalThis.__bRulesEngine = setInterval(async () => {
    if (globalThis.__bRulesBusy) return;
    globalThis.__bRulesBusy = true;
    try {
      await checkExitRules();
      const { deployTreasury } = await import("./treasury");
      await deployTreasury();
    } catch {
      // next tick retries
    } finally {
      globalThis.__bRulesBusy = false;
    }
  }, 60_000);
  globalThis.__bRulesEngine.unref?.();
}

// ---------- portfolio valuation ----------

export type PositionToken = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  qty: number;
  cost: number;
  price: number | null;
  value: number;
  /** true when no live or stale price exists — valued at 0, write-off eligible */
  unpriced?: boolean;
  change24h: number | null;
};

export type Position = {
  basket: BasketRow;
  kind: "coin" | "trader";
  value: number;
  cost: number;
  tokens?: PositionToken[];
  units?: number;
  nav?: number;
  rule?: ExitRule | null;
};

export async function getPortfolio(userId: number): Promise<{
  cash: number;
  positions: Position[];
  totalValue: number;
  totalCost: number;
}> {
  ensureRulesEngine();
  const db = getDb();
  const user = db.prepare("SELECT cash FROM users WHERE id = ?").get(userId) as { cash: number };

  const coinRows = db
    .prepare(
      `SELECT h.basket_id, h.mint, h.qty, h.cost, tm.symbol, tm.name, tm.icon
       FROM holdings h JOIN token_meta tm ON tm.mint = h.mint
       WHERE h.user_id = ? AND h.qty > 0`
    )
    .all(userId) as {
    basket_id: number; mint: string; qty: number; cost: number;
    symbol: string; name: string; icon: string | null;
  }[];

  const prices = await getPrices(coinRows.map((r) => r.mint));
  const byBasket = new Map<number, PositionToken[]>();
  for (const r of coinRows) {
    const p = prices[r.mint];
    const price = p?.usdPrice ?? null;
    const list = byBasket.get(r.basket_id) ?? [];
    list.push({
      mint: r.mint,
      symbol: r.symbol,
      name: r.name,
      icon: r.icon,
      qty: r.qty,
      cost: r.cost,
      price,
      // No live or stale price at all means nobody will buy it — valuing at
      // cost would inflate the portfolio (and every equity snapshot) with a
      // number that can never be realized. Value 0, flag it, let the
      // write-off flow close it out.
      value: price != null ? r.qty * price : 0,
      unpriced: price == null,
      change24h: p?.priceChange24h ?? null,
    });
    byBasket.set(r.basket_id, list);
  }

  const positions: Position[] = [];
  for (const [basketId, tokens] of byBasket) {
    const basket = getBasket(basketId);
    if (!basket) continue;
    tokens.sort((a, b) => b.value - a.value);
    positions.push({
      basket,
      kind: "coin",
      tokens,
      value: tokens.reduce((s, t) => s + t.value, 0),
      cost: tokens.reduce((s, t) => s + t.cost, 0),
    });
  }

  const traderRows = db
    .prepare("SELECT basket_id, units, cost FROM trader_holdings WHERE user_id = ? AND units > 0")
    .all(userId) as { basket_id: number; units: number; cost: number }[];
  // NAVs hit live wallet balances — fetch them concurrently, not one per basket
  const traderPositions = await Promise.all(
    traderRows.map(async (r) => {
      const basket = getBasket(r.basket_id);
      if (!basket) return null;
      const nav = await getTraderBasketNavLive(basket.id);
      return {
        basket,
        kind: "trader" as const,
        units: r.units,
        nav,
        value: r.units * nav,
        cost: r.cost,
      };
    })
  );
  for (const p of traderPositions) if (p) positions.push(p);

  const ruleRows = db
    .prepare("SELECT basket_id, tp_pct, sl_pct, close_at FROM position_rules WHERE user_id = ?")
    .all(userId) as (ExitRule & { basket_id: number })[];
  const ruleByBasket = new Map(ruleRows.map((r) => [r.basket_id, r]));
  for (const p of positions) p.rule = ruleByBasket.get(p.basket.id) ?? null;

  positions.sort((a, b) => b.value - a.value);
  const totalValue = positions.reduce((s, p) => s + p.value, 0) + user.cash;
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  return { cash: user.cash, positions, totalValue, totalCost };
}

const SNAPSHOT_MIN_GAP_MS = 10 * 60_000;

export async function recordSnapshot(userId: number, force = false): Promise<void> {
  const db = getDb();
  const last = db
    .prepare("SELECT ts FROM snapshots WHERE user_id = ? ORDER BY ts DESC LIMIT 1")
    .get(userId) as { ts: number } | undefined;
  if (!force && last && Date.now() - last.ts < SNAPSHOT_MIN_GAP_MS) return;
  const { totalValue } = await getPortfolio(userId);
  db.prepare("INSERT INTO snapshots (user_id, ts, value) VALUES (?, ?, ?)").run(
    userId,
    Date.now(),
    totalValue
  );
}

export function getSnapshots(userId: number): { ts: number; value: number }[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT ts, value FROM snapshots WHERE user_id = ? ORDER BY ts DESC LIMIT 2000")
    .all(userId) as { ts: number; value: number }[];
  return rows.reverse();
}
