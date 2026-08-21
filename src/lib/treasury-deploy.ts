// The treasury puts its own fees to work, and the profit buys back the token.
//
// The loop the tokenomics page describes, as actual code:
//   fees land as SOL  ->  deployed into the best-performing public baskets
//   those positions gain  ->  profit is realised and queued for buyback & burn
//   principal recycles into the next deployment
//
// The treasury trades through EXACTLY the same audited path as a user: same
// per-leg confirmation, same ledger writes, same reconciliation. It is a normal
// account that happens to be owned by the protocol, which means every guard
// written for user money already protects treasury money.
import { getDb } from "./db";
import { recordLedger, solPriceUsd, treasuryWallet } from "./treasury";

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Keep this much SOL unspent for network fees and fee-collection transfers. */
const RESERVE_LAMPORTS = 30_000_000; // 0.03 SOL
/** Don't deploy at all below this — the swap costs would eat the position. */
const MIN_DEPLOY_LAMPORTS = 50_000_000; // 0.05 SOL
/** Never put more than this share of the treasury into a single basket. */
const MAX_PER_BASKET = 0.34;
/** Realise a position once it is up this much; below it, let it run. */
const HARVEST_PROFIT_PCT = 25;
/** Cut a treasury position that falls this far, so one basket can't drain it. */
const STOP_LOSS_PCT = 40;

export type TreasuryAccount = { userId: number; address: string } | null;

/**
 * The protocol's own account. Reuses the system user that owns the seeded
 * baskets, and attaches the treasury wallet to it so the ordinary trading
 * path can sign for it.
 */
export function getTreasuryAccount(): TreasuryAccount {
  const db = getDb();
  const dest = treasuryWallet();
  const key = process.env.TREASURY_WALLET_KEY?.trim();
  if (!dest || !key) return null;
  // The key must be an AES-GCM blob (iv:tag:ciphertext). A raw base58 secret
  // here would fail to decrypt on every single signing attempt, and those
  // failures are caught and swallowed — so it would look like the treasury
  // simply never trades, with nothing explaining why.
  if (!/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(key)) {
    console.error("[treasury] TREASURY_WALLET_KEY is not an encrypted blob — treasury disabled");
    return null;
  }

  const row = db
    .prepare("SELECT id, wallet_address FROM users WHERE email = 'system@basket.rich'")
    .get() as { id: number; wallet_address: string | null } | undefined;
  if (!row) return null;

  // Attach the treasury wallet once; afterwards this is a no-op.
  if (row.wallet_address !== dest) {
    // ROTATION SAFETY. Positions in the ledger were bought by the PREVIOUS
    // wallet and the tokens still live there — the new wallet does not hold
    // them. Carrying those rows over would make the treasury value holdings
    // it cannot sell, and harvest would try to sell tokens that are not there.
    //
    // Clear them and say so on the ledger. The old wallet's tokens are not
    // lost: its key is in the backup file and it can be swept manually.
    const orphaned = db
      .prepare("SELECT COUNT(*) AS n FROM holdings WHERE user_id = ?")
      .get(row.id) as { n: number };
    // Do NOT delete blindly: if the operator swept the tokens into the new
    // wallet, the positions are real and deleting them destroys the record of
    // assets we still hold. getPortfolio reconciles against the chain anyway,
    // so leaving them is self-correcting; wiping them is not reversible.
    if (row.wallet_address && orphaned.n > 0) {
      recordLedger({
        kind: "deploy",
        amountUsd: 0,
        detail: `Treasury wallet rotated — ${orphaned.n} position(s) were bought by ${row.wallet_address.slice(0, 8)}…; sweep that wallet or they will reconcile away`,
      });
    }
    db.prepare("UPDATE users SET wallet_address = ?, wallet_key = ? WHERE id = ?").run(
      dest,
      key,
      row.id
    );
  }
  return { userId: row.id, address: dest };
}

export type DeployCandidate = {
  basketId: number;
  name: string;
  change24h: number;
  investors: number;
};

/**
 * Which baskets deserve the treasury's money.
 *
 * Deliberately conservative: public coin baskets only, positive recent
 * performance, and at least one real investor — the treasury should follow
 * demonstrated interest, not bootstrap an empty basket with its own capital
 * and call the result traction.
 */
export async function pickTargets(limit = 3): Promise<DeployCandidate[]> {
  const db = getDb();
  const { basketChange24h, investorCount } = await import("./portfolio");
  const rows = db
    .prepare("SELECT id, name, kind, is_public FROM baskets WHERE kind = 'coin' AND is_public = 1")
    .all() as { id: number; name: string; kind: string; is_public: number }[];

  const scored: DeployCandidate[] = [];
  for (const b of rows) {
    const change = await basketChange24h({ ...b, kind: "coin" } as never);
    if (change == null || change <= 0) continue;
    const investors = investorCount(b.id);
    if (investors < 1) continue;
    scored.push({ basketId: b.id, name: b.name, change24h: change, investors });
  }
  scored.sort((a, b) => b.change24h - a.change24h);
  return scored.slice(0, limit);
}

/** Idle SOL the treasury could put to work right now. */
export async function idleLamports(): Promise<number> {
  const acct = getTreasuryAccount();
  if (!acct) return 0;
  const { getSolBalance } = await import("./accounts");
  const balance = await getSolBalance(acct.address).catch(() => 0);

  // Ring-fence anything already credited to the burn queue. Realised profit is
  // owed to token holders, so redeploying it would mean promising the same SOL
  // twice — burned and invested.
  const { queuedForBurnUsd } = await import("./burn");
  const sol = (await solPriceUsd()) ?? 0;
  const owed = sol > 0 ? Math.floor((queuedForBurnUsd() / sol) * LAMPORTS_PER_SOL) : 0;

  return Math.max(0, balance - RESERVE_LAMPORTS - owed);
}

/**
 * Put idle fee revenue into the best-performing baskets.
 * Returns what it actually did — never throws into the caller's tick.
 */
export async function deployTreasury(): Promise<{ deployed: number; into: string[] }> {
  const acct = getTreasuryAccount();
  if (!acct) return { deployed: 0, into: [] };

  const idle = await idleLamports();
  if (idle < MIN_DEPLOY_LAMPORTS) return { deployed: 0, into: [] };

  const targets = await pickTargets(3);
  if (targets.length === 0) return { deployed: 0, into: [] };

  const { investInBasket, getPortfolio } = await import("./portfolio");
  // Cap against TOTAL exposure, not just this tick's idle. Enforcing the limit
  // per-cycle let repeated cycles pile the whole treasury into one basket.
  const { positions } = await getPortfolio(acct.userId);
  const solUsd = (await solPriceUsd()) ?? 0;
  const existingByBasket = new Map(positions.map((p) => [p.basket.id, p.value]));
  const portfolioUsd = positions.reduce((a, p) => a + p.value, 0) + (idle / LAMPORTS_PER_SOL) * solUsd;

  const perBasket = Math.min(
    Math.floor(idle / targets.length),
    Math.floor(idle * MAX_PER_BASKET)
  );
  if (perBasket < MIN_DEPLOY_LAMPORTS) return { deployed: 0, into: [] };

  const into: string[] = [];
  let deployed = 0;
  for (const t of targets) {
    try {
      // Skip a basket that is already at or over the concentration limit.
      if (portfolioUsd > 0 && solUsd > 0) {
        const already = existingByBasket.get(t.basketId) ?? 0;
        const after = already + (perBasket / LAMPORTS_PER_SOL) * solUsd;
        if (after / portfolioUsd > MAX_PER_BASKET) continue;
      }
      await investInBasket(acct.userId, t.basketId, perBasket / LAMPORTS_PER_SOL);
      deployed += perBasket;
      into.push(t.name);
      recordLedger({
        kind: "deploy",
        amountUsd: 0,
        amountSol: perBasket / LAMPORTS_PER_SOL,
        basketId: t.basketId,
        detail: `Treasury deployed ${(perBasket / LAMPORTS_PER_SOL).toFixed(4)} SOL into "${t.name}" (+${t.change24h.toFixed(1)}% 24h)`,
      });
    } catch {
      // a basket that can't be routed right now is skipped, not fatal
    }
  }
  return { deployed, into };
}

/**
 * Realise treasury gains and queue them for buyback & burn.
 *
 * Only the PROFIT is queued — principal recycles into the next deployment, so
 * the treasury compounds rather than slowly emptying itself into burns.
 */
export async function harvestTreasury(): Promise<{ harvested: number; burned: number }> {
  const acct = getTreasuryAccount();
  if (!acct) return { harvested: 0, burned: 0 };

  const { getPortfolio, redeemFromBasket } = await import("./portfolio");
  const { positions } = await getPortfolio(acct.userId);
  const sol = (await solPriceUsd()) ?? 0;

  let harvested = 0;
  let queued = 0;
  for (const p of positions) {
    if (p.cost <= 0) continue;
    // A position we cannot price is not a position that fell. Blanket-selling
    // on a feed outage — and then writing the tokens off at $0 via
    // allowUnpriced — would destroy real value over a temporary API problem.
    const legs = p.tokens ?? [];
    if (legs.length > 0 && legs.every((t) => t.unpriced)) continue;
    const anyUnpriced = legs.some((t) => t.unpriced);

    const pnlPct = ((p.value - p.cost) / p.cost) * 100;
    const takeProfit = pnlPct >= HARVEST_PROFIT_PCT;
    const cutLoss = pnlPct <= -STOP_LOSS_PCT && !anyUnpriced;
    if (!takeProfit && !cutLoss) continue;

    try {
      const proceeds = await redeemFromBasket(
        acct.userId,
        p.basket.id,
        1,
        `Treasury ${takeProfit ? "harvest" : "stop-loss"} on ${p.basket.name} at ${pnlPct.toFixed(1)}%`,
        { allowUnpriced: true }
      );
      harvested++;
      const profitUsd = proceeds - p.cost;
      if (profitUsd > 0) {
        queued += profitUsd;
        recordLedger({
          kind: "treasury_pnl",
          amountUsd: profitUsd,
          amountSol: sol > 0 ? profitUsd / sol : null,
          basketId: p.basket.id,
          detail: `Treasury profit on "${p.basket.name}" queued for buyback & burn`,
        });
      }
    } catch {
      // retry next cycle
    }
  }
  return { harvested, burned: queued };
}

/**
 * One full treasury cycle: harvest what has run, then redeploy what is idle.
 * Harvest first so realised principal is available to the same deployment.
 */
export async function runTreasuryCycle(): Promise<void> {
  try {
    await harvestTreasury();
  } catch {
    /* non-fatal */
  }
  // Burn BEFORE redeploying: realised profit is owed to the burn, not to the
  // next position. Deploying it first would compound money that is already
  // promised to token holders.
  try {
    const { runBurnCycle } = await import("./burn");
    await runBurnCycle();
  } catch {
    /* non-fatal */
  }
  try {
    await deployTreasury();
  } catch {
    /* non-fatal */
  }
}
