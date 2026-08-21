import { getDb } from "./db";
import { getPrices } from "./prices";
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

/**
 * A token listed less than 24h ago reports a nonsense 24h change (it had no
 * price yesterday) — five figures is common. Averaging that into a basket
 * headline makes the whole number a lie, so those legs are excluded the same
 * way an unpriced leg is: they simply don't contribute.
 */
const MAX_SANE_24H_PCT = 400;

/** Weighted 24h performance. Trader baskets need ≥24h of real snapshots; null until then. */
export async function basketChange24h(basket: BasketRow): Promise<number | null> {
  if (basket.kind === "coin") {
    const tokens = getBasketTokens(basket.id);
    const prices = await getPrices(tokens.map((t) => t.mint));
    let acc = 0;
    let w = 0;
    for (const t of tokens) {
      const ch = prices[t.mint]?.priceChange24h;
      if (ch != null && Math.abs(ch) <= MAX_SANE_24H_PCT) {
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

// ---------- investing (REAL on-chain execution, no virtual money) ----------

export class InvestError extends Error {}

const PRICE_MAX_STALE_MS = 5 * 60_000; // valuations never use prices older than this
const LAMPORTS_PER_SOL = 1_000_000_000;
const MIN_INVEST_SOL = 0.01;

/**
 * How many swap legs may be in flight at once. Three cuts an 8-leg exit from
 * ~8 confirmations end-to-end to ~3, without hammering Jupiter's free-tier
 * rate limit on the build endpoint (which 429s under sustained parallelism).
 */
const LEG_CONCURRENCY = 3;

/**
 * Run one job per leg through a small worker pool.
 *
 * Concurrency is safe here because each leg is self-contained end-to-end: its
 * swap CONFIRMS on-chain before its ledger rows are written, and those writes
 * happen in one synchronous transaction (no await inside), so legs can never
 * interleave half-recorded state. On-chain, Solana write-locks the accounts a
 * transaction touches and every Jupiter swap idempotently (re)creates the
 * wSOL account it uses, so same-wallet swaps tolerate being in flight
 * together. After the first failure no NEW legs are dispatched — in-flight
 * legs finish and record, unstarted legs stay untouched.
 */
async function runLegPool<T>(
  items: T[],
  job: (item: T) => Promise<boolean> // false = failure, stop dispatching
): Promise<void> {
  let cursor = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(LEG_CONCURRENCY, items.length)) }, async () => {
      while (!failed && cursor < items.length) {
        const item = items[cursor++];
        if (!(await job(item))) failed = true;
      }
    })
  );
}

/**
 * Invest by executing REAL Jupiter swaps from the account wallet's SOL into
 * every leg of the basket. The tokens land in the user's own wallet; the
 * holdings table is the per-basket ledger of what those swaps acquired, so
 * P&L, exit rules and redeems know which tokens belong to which thesis.
 */
export async function investInBasket(
  userId: number,
  basketId: number,
  amountSol: number
): Promise<{ signatures: string[]; allocatedOnly?: boolean }> {
  // Squad investing must hold the SAME lock the mirror engine uses. The pledge
  // is written before any routing, so without this a sync landing in that
  // window sees the full allocation against zero holdings and deploys the
  // money a second time. Fail loudly rather than silently taking a deposit.
  const b = getBasket(basketId);
  if (b && b.kind !== "coin") {
    const { withMirrorLock } = await import("./mirror");
    return withMirrorLock(
      userId,
      basketId,
      () => investInBasketInner(userId, basketId, amountSol),
      () => {
        throw new InvestError(
          "A copy-trade sync is running for this squad — try again in a few seconds."
        );
      }
    );
  }
  return investInBasketInner(userId, basketId, amountSol);
}

async function investInBasketInner(
  userId: number,
  basketId: number,
  amountSol: number
): Promise<{ signatures: string[]; allocatedOnly?: boolean }> {
  ensureRulesEngine();
  const db = getDb();
  const basket = getBasket(basketId);
  if (!basket || (!basket.is_public && basket.owner_id !== userId)) {
    throw new InvestError("Basket not found");
  }
  if (!Number.isFinite(amountSol) || amountSol < MIN_INVEST_SOL) {
    throw new InvestError(`Minimum investment is ${MIN_INVEST_SOL} SOL`);
  }

  // A coin basket has fixed weights. A TRADER basket mirrors what its member
  // wallets actually hold right now — that is the copy-trade: your own wallet
  // buys the squad's live portfolio, weighted, with nothing pooled.
  let tokens: { mint: string; symbol: string; weight: number; decimals: number }[];
  // Coin baskets deploy the full amount. A trader basket deploys only the
  // share the squad itself has in positions — see deployPct.
  let deployPct = 1;
  if (basket.kind === "coin") {
    tokens = getBasketTokens(basketId);
    if (tokens.length === 0) throw new InvestError("Basket has no tokens");
  } else {
    const { getSquadPortfolio, squadIsMirrorable } = await import("./squad");
    const squad = await getSquadPortfolio(basketId);
    const check = squadIsMirrorable(squad);
    if (!check.ok) throw new InvestError(check.reason ?? "This squad can't be mirrored right now");
    deployPct = squad.deployPct;
    tokens = squad.legs.map((l) => ({
      mint: l.mint,
      symbol: l.symbol,
      weight: l.weight,
      decimals: l.decimals,
    }));
    // Mirrored legs may be tokens we have never stored — record them so
    // valuation, redeem and the UI can name them later.
    for (const l of squad.legs) {
      db.prepare(
        "INSERT OR IGNORE INTO token_meta (mint, symbol, name, icon, decimals, coingecko_id, tracked) VALUES (?, ?, ?, ?, ?, NULL, 0)"
      ).run(
        l.mint,
        l.symbol,
        l.symbol,
        `https://dd.dexscreener.com/ds-data/tokens/solana/${l.mint}.png?size=lg`,
        l.decimals
      );
    }
  }

  const { getAccountWallet, getSolBalance, signSendConfirmOne, WITHDRAW_RESERVE_LAMPORTS } =
    await import("./accounts");
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new InvestError("This account has no wallet yet");
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const balance = await getSolBalance(wallet.address);
  if (lamports + WITHDRAW_RESERVE_LAMPORTS > balance) {
    const max = Math.max(0, balance - WITHDRAW_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL;
    throw new InvestError(
      max >= MIN_INVEST_SOL
        ? `Not enough SOL — you can invest up to ${max.toFixed(4)} SOL`
        : "Deposit SOL to your account wallet first"
    );
  }

  // Funding a squad is a STANDING ALLOCATION. Record the pledge before any
  // routing, so that even if they are wholly in cash right now the commitment
  // is on the books and the mirror engine deploys it the moment they enter.
  if (basket.kind !== "coin") {
    const { getAllocation, setAllocation } = await import("./mirror");
    const existing = getAllocation(userId, basketId);
    // A pledge you cannot fund is not a pledge. Cap the TOTAL standing
    // allocation at what the wallet actually holds, minus fee headroom —
    // otherwise repeated clicks (which look like nothing happened while the
    // squad sits in cash) silently commit money that isn't there.
    const ceiling = Math.max(0, balance - WITHDRAW_RESERVE_LAMPORTS);
    const requested = existing + lamports;
    if (existing >= ceiling) {
      throw new InvestError(
        `You already have ${(existing / LAMPORTS_PER_SOL).toFixed(3)} SOL allocated to this squad — that is your whole balance. Deposit more SOL to increase it.`
      );
    }
    setAllocation(userId, basketId, Math.min(requested, ceiling));
  }

  const { quoteBasketLegs, buildSwapTransactions } = await import("./swap");
  const { solPriceUsd } = await import("./treasury");
  // Mirroring a squad means mirroring their CASH too: if they hold 60% in
  // positions, only 60% of this deposit buys tokens and the rest stays as SOL
  // in the user's wallet, ready for when the squad re-enters.
  // Platform swap fee comes off the top, in SOL, before anything is routed.
  // Taking it here (rather than through Jupiter) means it works for any token
  // and is always denominated in what the user deposited.
  const { collectSwapFee, swapFeeLamports } = await import("./fees");
  const feeLamports = swapFeeLamports(lamports);
  const investable = lamports - feeLamports;

  const deployLamports = Math.floor(investable * deployPct);
  if (deployLamports < 10_000_000) {
    // Nothing to deploy right now — either the squad is in cash or their
    // positions are a sliver. Under the allocation model that is a normal
    // resting state, not an error: the pledge is recorded and the engine
    // enters when they do.
    if (basket.kind !== "coin") {
      await recordSnapshot(userId, true);
      return { signatures: [], allocatedOnly: true };
    }
    throw new InvestError(
      "This order is too small to route across the basket — try a larger amount."
    );
  }
  const legs = await quoteBasketLegs(
    tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, weight: t.weight })),
    deployLamports,
    100
  );
  const sol = (await solPriceUsd()) ?? 0;
  await collectSwapFee({
    userId,
    basketId,
    lamports,
    side: "buy",
    solPrice: sol,
  });
  const decimalsOf = new Map(tokens.map((t) => [t.mint, t.decimals]));
  const signatures: string[] = [];
  let spentSol = 0;
  let failure: unknown = null;

  // Persist each leg the moment ITS OWN swap is CONFIRMED on-chain. Never
  // batch-then-record: if one leg fails, the ones that landed are already real
  // on-chain, so they must already be real in the ledger — otherwise a retry
  // double-buys them and the tokens look like they came from nowhere. Equally,
  // nothing is recorded for a swap that didn't confirm. Legs run through a
  // small pool (see runLegPool) so a five-leg buy waits on ~2 confirmation
  // rounds instead of five in a row.
  await runLegPool(legs, async (leg) => {
    try {
      const [tx] = await buildSwapTransactions([leg], wallet.address);
      const sig = await signSendConfirmOne(userId, tx);
      signatures.push(sig);
      const legSol = leg.lamportsIn / LAMPORTS_PER_SOL;
      spentSol += legSol;
      const qty = Number(leg.outAmount) / 10 ** (decimalsOf.get(leg.mint) ?? 6);
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO holdings (user_id, basket_id, mint, qty, cost) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, basket_id, mint) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost`
        ).run(userId, basketId, leg.mint, qty, legSol * sol);
        db.prepare(
          "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'invest', ?, ?, ?, ?)"
        ).run(
          userId,
          basketId,
          legSol * sol,
          `Bought ${leg.symbol} for ${basket.name} — ${legSol.toFixed(4)} SOL · ${sig}`,
          Date.now()
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return true;
    } catch (e) {
      failure = failure ?? e; // in-flight legs finish; unstarted legs are never sent
      return false;
    }
  });

  await recordSnapshot(userId, true);

  if (failure && signatures.length === 0) {
    throw failure instanceof Error ? failure : new InvestError("The swap failed");
  }
  if (failure) {
    throw new PartialInvestError(
      signatures.length,
      legs.length,
      spentSol,
      failure instanceof Error ? failure.message : "a leg failed"
    );
  }

  void (async () => {
    try {
      const { alertUser, money } = await import("./telegram");
      await alertUser(
        userId,
        "fill",
        `${basketId}:${signatures[0] ?? Date.now()}`,
        `✅ <b>Buy filled</b>\n\n<b>${basket.name}</b>\n${spentSol.toFixed(4)} SOL${sol ? ` ≈ ${money(spentSol * sol)}` : ""} across ${legs.length} token${legs.length === 1 ? "" : "s"}.`
      );
    } catch {
      /* alerts never block a trade */
    }
  })();

  return { signatures };
}

/**
 * Some legs bought and were recorded, then a later leg failed. The position
 * exists and is accurate — just smaller than requested. Surfaced explicitly so
 * the user can reconcile the app against their wallet instead of guessing.
 */
export class PartialInvestError extends InvestError {
  constructor(
    public filled: number,
    public total: number,
    public spentSol: number,
    reason: string
  ) {
    super(
      `Bought ${filled} of ${total} legs — ${spentSol.toFixed(4)} SOL spent and recorded — then stopped: ${reason}. Your position reflects exactly what executed.`
    );
  }
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
  // Same race in reverse: holdings are sold leg by leg while the pledge stays
  // full, so a sync landing mid-redeem reads "allocation intact, holdings
  // gone" and buys the position straight back — into a firing stop-loss.
  const rb = getBasket(basketId);
  if (rb && rb.kind !== "coin") {
    const { withMirrorLock } = await import("./mirror");
    return withMirrorLock(
      userId,
      basketId,
      () => redeemFromBasketInner(userId, basketId, fraction, note, opts),
      () => {
        throw new InvestError(
          "A copy-trade sync is running for this squad — try again in a few seconds."
        );
      }
    );
  }
  return redeemFromBasketInner(userId, basketId, fraction, note, opts);
}

async function redeemFromBasketInner(
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

  const rows = db
    .prepare(
      `SELECT h.mint, h.qty, h.cost, tm.symbol, tm.decimals
       FROM holdings h JOIN token_meta tm ON tm.mint = h.mint
       WHERE h.user_id = ? AND h.basket_id = ? AND h.qty > 0`
    )
    .all(userId, basketId) as {
    mint: string; qty: number; cost: number; symbol: string; decimals: number;
  }[];
  if (rows.length === 0) {
    if (!basket.is_public && basket.owner_id !== userId) throw new InvestError("Basket not found");
    throw new InvestError("Nothing to redeem in this basket");
  }

  const { getAccountWallet, signSendConfirmOne } = await import("./accounts");
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new InvestError("This account has no wallet yet");

  // Actual on-chain balances cap what we can sell — the ledger can drift if
  // the user sold or moved tokens from the wallet page. Never quote more than
  // the wallet really holds.
  const { getAccountHoldings } = await import("./trading");
  const live = await getAccountHoldings(userId);
  const liveRaw = new Map(live.tokens.map((t) => [t.mint, BigInt(t.rawAmount)]));

  const toSell = rows.map((r) => {
    const ledgerRaw = BigInt(Math.floor(r.qty * fraction * 10 ** r.decimals));
    const walletRaw = liveRaw.get(r.mint) ?? BigInt(0);
    // The wallet is shared across baskets, so capping at the FULL balance let
    // one basket's redeem sell tokens another basket had bought. Cap at this
    // basket's own share of that mint instead.
    const totalLedgerQty = (db
      .prepare("SELECT COALESCE(SUM(qty),0) AS q FROM holdings WHERE user_id = ? AND mint = ? AND qty > 0")
      .get(userId, r.mint) as { q: number }).q;
    const share =
      totalLedgerQty > 0
        ? (walletRaw * BigInt(Math.floor((r.qty / totalLedgerQty) * 10_000))) / BigInt(10_000)
        : walletRaw;
    const cap = share < walletRaw ? share : walletRaw;
    return { ...r, rawAmount: ledgerRaw < cap ? ledgerRaw : cap };
  });

  const { quoteExitLegs, buildSwapTransactions } = await import("./swap");
  const { solPriceUsd, takePerformanceFee: takeFee, treasuryWallet, PERFORMANCE_FEE_BPS } =
    await import("./treasury");
  const sellable = toSell.filter((s) => s.rawAmount > BigInt(0));
  const quoted = await quoteExitLegs(
    sellable.map((s) => ({ mint: s.mint, symbol: s.symbol, rawAmount: s.rawAmount.toString() })),
    150
  );
  const quotedMints = new Set(quoted.map((q) => q.mint));
  const unrouteable = sellable.filter((s) => !quotedMints.has(s.mint));
  if (unrouteable.length > 0 && !opts.allowUnpriced) {
    // dead legs: no route back to SOL — the caller can consent to write-off
    throw new UnpricedLegsError(unrouteable.map((s) => s.symbol));
  }

  const sol = (await solPriceUsd()) ?? 0;
  const quotedByMint = new Map(quoted.map((q) => [q.mint, q]));
  const signatures: string[] = [];
  let proceedsSol = 0;
  let costRedeemed = 0;
  let sellFailure: unknown = null;

  // Each leg confirms its own swap, then retires itself from the ledger in
  // one synchronous transaction. A failing leg can then never un-record a sale
  // that already happened, nor leave a sold leg still showing as held. Legs
  // run through a small pool (see runLegPool) — this was the single biggest
  // reason exits felt slow: an 8-leg basket used to wait through 8
  // confirmations back to back.
  await runLegPool(rows, async (r) => {
    const q = quotedByMint.get(r.mint);
    const legCost = r.cost * fraction;
    let legSol = 0;
    let sig: string | null = null;

    if (q) {
      try {
        const [tx] = await buildSwapTransactions([q], wallet.address);
        sig = await signSendConfirmOne(userId, tx);
        legSol = Number(q.outAmount) / LAMPORTS_PER_SOL;
      } catch (e) {
        sellFailure = sellFailure ?? e;
        return false; // this leg stays in the ledger; no further legs dispatch
      }
    }
    // No quote for this leg means it is unrouteable and the caller already
    // consented to writing it off at zero (checked above).

    db.exec("BEGIN");
    try {
      if (fraction >= 0.9999) {
        db.prepare("DELETE FROM holdings WHERE user_id = ? AND basket_id = ? AND mint = ?").run(
          userId, basketId, r.mint
        );
      } else {
        db.prepare(
          "UPDATE holdings SET qty = qty * ?, cost = cost * ? WHERE user_id = ? AND basket_id = ? AND mint = ?"
        ).run(1 - fraction, 1 - fraction, userId, basketId, r.mint);
      }
      db.prepare(
        "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'redeem', ?, ?, ?, ?)"
      ).run(
        userId, basketId, legSol * sol,
        sig
          ? `Sold ${r.symbol} from ${basket.name} — ${legSol.toFixed(4)} SOL · ${sig}`
          : `Wrote off ${r.symbol} from ${basket.name} — no route back to SOL`,
        Date.now()
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      sellFailure = sellFailure ?? e;
      return false;
    }
    // Totals count only legs whose ledger rows committed — the fees charged on
    // proceeds further down must be charged on recorded sales, nothing else.
    proceedsSol += legSol;
    costRedeemed += legCost;
    if (sig) signatures.push(sig);
    return true;
  });

  const soldEverything = !sellFailure;
  if (soldEverything && basket.kind !== "coin") {
    // Reduce the standing pledge by the same fraction, otherwise the mirror
    // engine would treat the sale as drift and immediately buy it all back.
    const { getAllocation, setAllocation } = await import("./mirror");
    const current = getAllocation(userId, basketId);
    setAllocation(userId, basketId, Math.floor(current * (1 - fraction)));
  }
  if (soldEverything && fraction >= 0.9999) {
    // exit rules belong to the position, not the basket — retire them with it
    db.prepare("DELETE FROM position_rules WHERE user_id = ? AND basket_id = ?").run(userId, basketId);
  }

  const proceeds = proceedsSol * sol;

  // Swap fee on the way out too, taken from the SOL the sells produced.
  if (proceedsSol > 0) {
    const { collectSwapFee } = await import("./fees");
    await collectSwapFee({
      userId,
      basketId,
      lamports: Math.floor(proceedsSol * LAMPORTS_PER_SOL),
      side: "sell",
      solPrice: sol,
    });
  }

  // Performance fee LAST: 10% of realised profit, only on what actually sold
  // and only after those sales are committed. Settled as a real SOL transfer
  // when the treasury wallet is configured; accrued on the ledger either way.
  let fee = 0;
  let feeSig: string | null = null;
  const profit = proceeds - costRedeemed;
  const dest = treasuryWallet();
  if (profit > 0 && sol > 0) {
    const feeSol = (profit * (PERFORMANCE_FEE_BPS / 10_000)) / sol;
    if (dest && feeSol >= 0.0005) {
      try {
        const { buildSolTransfer } = await import("./swap");
        const tx = await buildSolTransfer(wallet.address, dest, Math.floor(feeSol * LAMPORTS_PER_SOL));
        feeSig = await signSendConfirmOne(userId, tx);
      } catch {
        feeSig = null; // accrued below either way
      }
    }
    fee = takeFee({
      userId, basketId, basketName: basket.name, proceeds, costRedeemed,
      settledSol: feeSig ? feeSol : null, settledSig: feeSig,
    });
  }
  const net = proceeds - (feeSig ? fee : 0);

  if (note || fee > 0) {
    // summary row for the auto-exit reason and/or the fee
    db.prepare(
      "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'redeem', ?, 0, ?, ?)"
    ).run(
      userId, basketId,
      (note ?? `Redeemed ${(fraction * 100).toFixed(0)}% of ${basket.name}`) +
        ` · ${proceedsSol.toFixed(4)} SOL total` +
        (fee > 0
          ? ` · $${fee.toFixed(2)} performance fee ${feeSig ? "sent" : "accrued"} → buyback & burn`
          : ""),
      Date.now()
    );
  }

  if (sellFailure) {
    await recordSnapshot(userId, true);
    throw new InvestError(
      `Sold ${signatures.length} of ${rows.length} legs (${proceedsSol.toFixed(4)} SOL, recorded) before failing: ${
        sellFailure instanceof Error ? sellFailure.message : "a leg failed"
      }. The rest of the position is untouched — try again.`
    );
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

async function positionValueAndCost(
  userId: number,
  basketId: number
): Promise<{ value: number; cost: number; hasDeadLeg: boolean } | null> {
  const db = getDb();
  const basket = getBasket(basketId);
  if (!basket) return null;
  // Value from HOLDINGS whenever there are any — squad mirrors write real
  // token rows here, while trader_holdings.units stays 0. Keying off
  // basket.kind meant a mirrored position was valued at zero, so stop-loss
  // and take-profit could never fire on a squad at all.
  const hasHoldings = !!db
    .prepare("SELECT 1 FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0 LIMIT 1")
    .get(userId, basketId);
  if (basket.kind === "coin" || hasHoldings) {
    const rows = db
      .prepare("SELECT mint, qty, cost FROM holdings WHERE user_id = ? AND basket_id = ? AND qty > 0")
      .all(userId, basketId) as { mint: string; qty: number; cost: number }[];
    if (rows.length === 0) return null;
    const prices = await getPrices(rows.map((r) => r.mint), { maxStaleMs: PRICE_MAX_STALE_MS });
    let value = 0;
    let cost = 0;
    let priced = 0;
    let unpriced = 0;
    for (const r of rows) {
      const p = prices[r.mint]?.usdPrice;
      cost += r.cost;
      if (!p || p <= 0) {
        unpriced++; // a specific token died: contributes 0 to value
        continue;
      }
      priced++;
      value += r.qty * p;
    }
    // Every leg unpriced means the FEED is down, not that the basket is
    // worthless — bail out rather than firing a stop-loss on an outage.
    if (priced === 0) return null;
    return { value, cost, hasDeadLeg: unpriced > 0 };
  }
  const row = db
    .prepare("SELECT units, cost FROM trader_holdings WHERE user_id = ? AND basket_id = ? AND units > 0")
    .get(userId, basketId) as { units: number; cost: number } | undefined;
  if (!row) return null;
  try {
    const nav = await getTraderBasketNavLive(basketId, { strict: true });
    return { value: row.units * nav, cost: row.cost, hasDeadLeg: false };
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
      // allowUnpriced: the rule already fired on a valuation that counted dead
      // legs as worthless. Without this, ONE unrouteable token would throw
      // UnpricedLegsError every tick and silently block the whole exit —
      // a stop-loss that never sells is worse than no stop-loss.
      const proceeds = await redeemFromBasket(
        r.user_id,
        r.basket_id,
        1,
        `${reason} — auto-exited ${basket?.name ?? "basket"}` +
          (pos.hasDeadLeg ? " (a leg had no route and was written off)" : ""),
        { allowUnpriced: true }
      );
      clearPositionRule(r.user_id, r.basket_id);

      void (async () => {
        try {
          const { alertUser, money } = await import("./telegram");
          const icon = reason!.startsWith("Take-profit")
            ? "🎯"
            : reason!.startsWith("Stop-loss")
              ? "🛡"
              : "⌛";
          await alertUser(
            r.user_id,
            "exit",
            `${r.basket_id}:${Math.floor(Date.now() / 60_000)}`,
            `${icon} <b>${reason}</b>\n\n<b>${basket?.name ?? "Basket"}</b> was closed automatically.\nProceeds: <b>${money(proceeds)}</b> back to your wallet as SOL.` +
              (pos.hasDeadLeg
                ? "\n\n⚠️ One leg had no route back to SOL and was written off."
                : "")
          );
        } catch {
          /* alerts never block an exit */
        }
      })();
    } catch {
      // partial fill or live-data hiccup — whatever sold is already recorded;
      // leave the rule armed so the next pass finishes the job
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __bRulesEngine: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __bRulesBusy: boolean | undefined;
  // eslint-disable-next-line no-var
  var __bTreasuryTick: number | undefined;
}

/** Checks armed exit rules every minute while the server runs. */
export function ensureRulesEngine(): void {
  if (globalThis.__bRulesEngine) return;
  // One line at startup so the deploy log always states which engines this
  // process is actually running with — reading the env var per tick is
  // invisible, and an engine that silently ISN'T running is the failure mode
  // that's hardest to notice.
  console.log(
    `[engines] mirror=${process.env.MIRROR_ENGINE_ENABLED === "1" ? "ON" : "off"} ` +
      `treasury=${process.env.TREASURY_ENGINE_ENABLED === "1" ? "ON" : "off"}`
  );
  globalThis.__bRulesEngine = setInterval(async () => {
    if (globalThis.__bRulesBusy) return;
    globalThis.__bRulesBusy = true;
    try {
      await checkExitRules();
      // Keep every standing squad allocation in step with what its wallets
      // hold. Webhooks make this near-instant; this tick is the safety net
      // that catches anything a missed delivery would otherwise strand.
      // KILL SWITCH — unset MIRROR_ENGINE_ENABLED to stop all mirror
      // spending instantly on the next tick, no redeploy needed. The preflight
      // audit's findings (unpriced legs read as have=0, invest/redeem races)
      // are fixed — unpriceable legs now abort the sync and invest/redeem
      // share the mirror lock — and the engine is live.
      if (process.env.MIRROR_ENGINE_ENABLED === "1") {
        const { activeAllocations, syncSquadMirror } = await import("./mirror");
        for (const a of activeAllocations()) {
          try {
            await syncSquadMirror(a.user_id, a.basket_id);
          } catch {
            // one allocation failing must not stall the others
          }
        }
      }

      // Treasury works on a much slower clock than user positions — it is
      // deploying accumulated revenue, not chasing candles. Once every 30
      // ticks (~30 min) is plenty and keeps swap costs off the P&L.
      globalThis.__bTreasuryTick = (globalThis.__bTreasuryTick ?? 0) + 1;
      if (globalThis.__bTreasuryTick % 30 === 0 && process.env.TREASURY_ENGINE_ENABLED === "1") {
        try {
          const { runTreasuryCycle } = await import("./treasury-deploy");
          await runTreasuryCycle();
        } catch {
          // treasury issues must never disturb user positions
        }
      }
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
  positions: Position[];
  totalValue: number;
  totalCost: number;
}> {
  ensureRulesEngine();
  const db = getDb();

  let coinRows = db
    .prepare(
      `SELECT h.basket_id, h.mint, h.qty, h.cost, tm.symbol, tm.name, tm.icon
       FROM holdings h JOIN token_meta tm ON tm.mint = h.mint
       WHERE h.user_id = ? AND h.qty > 0`
    )
    .all(userId) as {
    basket_id: number; mint: string; qty: number; cost: number;
    symbol: string; name: string; icon: string | null;
  }[];

  // RECONCILE AGAINST THE CHAIN before valuing anything.
  //
  // The wallet is the source of truth: if the ledger says you hold a token
  // that your wallet no longer has, the ledger is wrong — you sold it, moved
  // it, or it was swapped elsewhere. Valuing a position that does not exist
  // inflates the portfolio and, worse, leaves exit rules armed on nothing.
  try {
    const { getAccountHoldings } = await import("./trading");
    const live = await getAccountHoldings(userId);
    const onChain = new Map(live.tokens.map((t) => [t.mint, Number(t.rawAmount)]));
    // GRACE PERIOD. The balances indexer lags a confirmed swap by seconds, so
    // a position bought moments ago legitimately reads as absent on-chain.
    // Deleting it here would erase a real holding the user just paid for.
    const recent = new Set(
      (
        db
          .prepare(
            `SELECT DISTINCT detail FROM transactions
             WHERE user_id = ? AND created_at > ? AND type IN ('invest','trade')`
          )
          .all(userId, Date.now() - 180_000) as { detail: string }[]
      ).flatMap((t) => {
        const m = t.detail.match(/(?:Bought|Mirror buy)\s+(\S+)/);
        return m ? [m[1]] : [];
      })
    );
    const stale = coinRows.filter(
      (r) => (onChain.get(r.mint) ?? 0) <= 0 && !recent.has(r.symbol)
    );
    if (stale.length > 0) {
      db.exec("BEGIN");
      try {
        for (const r of stale) {
          db.prepare(
            "DELETE FROM holdings WHERE user_id = ? AND basket_id = ? AND mint = ?"
          ).run(userId, r.basket_id, r.mint);
        }
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
      }
      // drop them from this pass too, so the number shown is already correct
      coinRows = coinRows.filter((r) => (onChain.get(r.mint) ?? 0) > 0);
    }
  } catch {
    // Chain unreadable: value the ledger as-is rather than deleting positions
    // on the strength of a failed RPC call. Wrongly-high beats wrongly-gone.
  }

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
  const totalValue = positions.reduce((s, p) => s + p.value, 0);
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  return { positions, totalValue, totalCost };
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
