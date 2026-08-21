// Copy-trading for trader baskets.
//
// MODEL — deliberately non-pooled:
//   A trader basket is a coin basket whose weights are derived from what the
//   member wallets ACTUALLY HOLD right now, instead of being fixed by a
//   creator. When you invest, your own wallet buys that same portfolio,
//   weighted. You hold the tokens directly; nothing is pooled into a fund.
//
//   Economically this is identical to owning units of an index — your position
//   rises and falls with the squad's holdings — but no one is ever holding
//   everybody's money in one pot.
//
// HONEST LIMIT: positions are detected from wallet snapshots taken every few
// minutes, so a mirror can lag a KOL's entry. On memecoins that lag is
// material and is surfaced in the UI rather than hidden.
import { getDb } from "./db";
import { SOL_MINT, getWalletValue, mintSymbol } from "./wallets";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/**
 * Cash-equivalents: held, but not a "position" worth mirroring. Missing one
 * here would put a user's SOL into a stablecoin and call it a trade, so the
 * symbol check backs up the explicit mint list for stables we haven't listed.
 */
const NOT_A_POSITION = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);
const STABLE_SYMBOL = /^(w?USD[A-Z0-9]{0,3}|USD1|PYUSD|FDUSD|USDS|EURC|DAI|jitoSOL|mSOL|bSOL|JupSOL|INF|jlUSDC|hyUSD)$/i;

function isCashLike(mint: string, symbol: string): boolean {
  return NOT_A_POSITION.has(mint) || STABLE_SYMBOL.test(symbol);
}

export type SquadLeg = {
  mint: string;
  symbol: string;
  weight: number; // 0..1, sums to 1 across legs
  decimals: number;
  /** which members hold it, for "why is this here?" in the UI */
  heldBy: string[];
};

export type SquadPortfolio = {
  legs: SquadLeg[];
  /** members whose wallet value we could read */
  covered: number;
  members: number;
  /** oldest snapshot age across members (ms) — the real staleness of the mirror */
  lagMs: number;
  /** share of squad capital sitting in SOL/stables rather than positions */
  cashPct: number;
  /**
   * Fraction of YOUR deposit that should actually be deployed into tokens.
   *
   * This is the difference between copying a squad and over-exposing yourself
   * to it: if the KOLs are 95% in SOL, putting 100% of your money into the 5%
   * they hold in tokens is a 20x larger bet than they are making. Mirroring
   * their allocation means mirroring their CASH too.
   */
  deployPct: number;
};

const MAX_LEGS = 10; // Jupiter routing + fee sanity; also the basket cap
const MIN_LEG_WEIGHT = 0.02; // below 2% the swap costs more than the exposure
/** Below this the squad is effectively in cash and there is nothing to copy. */
const MIN_DEPLOY_PCT = 0.15;

/**
 * The portfolio a trader basket should mirror: every member's live positions,
 * combined by member weight and normalised.
 */
export async function getSquadPortfolio(basketId: number): Promise<SquadPortfolio> {
  const db = getDb();
  const members = db
    .prepare(
      `SELECT bt.trader_id, bt.weight, t.wallet, t.name
       FROM basket_traders bt JOIN traders t ON t.id = bt.trader_id
       WHERE bt.basket_id = ?`
    )
    .all(basketId) as { trader_id: number; weight: number; wallet: string; name: string }[];

  if (members.length === 0) {
    return { legs: [], covered: 0, members: 0, lagMs: 0, cashPct: 0, deployPct: 0 };
  }

  const totalW = members.reduce((s, m) => s + m.weight, 0) || 1;
  const byMint = new Map<string, { usd: number; heldBy: Set<string> }>();
  let covered = 0;
  let oldest = 0;
  let cashUsd = 0;
  let totalUsd = 0;

  const values = await Promise.all(
    members.map(async (m) => ({ m, v: await getWalletValue(m.wallet).catch(() => null) }))
  );

  for (const { m, v } of values) {
    if (!v || v.totalUsd <= 0) continue;
    covered++;
    oldest = Math.max(oldest, Date.now() - v.asOf);
    const share = m.weight / totalW;

    // Value the member's own book, then take our weighted slice of each leg.
    const positions = v.trackedAmounts.filter(([mint]) => !isCashLike(mint, mintSymbol(mint)));
    const posUsd = positions.reduce((s, [, amt, price]) => s + amt * price, 0);
    const memberTotal = v.totalUsd;
    totalUsd += memberTotal * share;
    cashUsd += Math.max(0, memberTotal - posUsd) * share;

    for (const [mint, amt, price] of positions) {
      const usd = amt * price;
      if (!(usd > 0)) continue;
      const cur = byMint.get(mint) ?? { usd: 0, heldBy: new Set<string>() };
      cur.usd += usd * share;
      cur.heldBy.add(m.name);
      byMint.set(mint, cur);
    }
  }

  const positionsUsd = [...byMint.values()].reduce((s, v) => s + v.usd, 0);
  if (positionsUsd <= 0) {
    return {
      legs: [],
      covered,
      members: members.length,
      lagMs: oldest,
      cashPct: totalUsd > 0 ? cashUsd / totalUsd : 1,
      deployPct: 0,
    };
  }

  // Decimals come from token_meta where we know them; 6 is the Solana norm and
  // is only used for display sizing, never for swap amounts (Jupiter quotes in
  // raw units from the wallet's actual balance).
  const decimalsFor = (mint: string): number => {
    const row = db.prepare("SELECT decimals FROM token_meta WHERE mint = ?").get(mint) as
      | { decimals: number }
      | undefined;
    return row?.decimals ?? 6;
  };

  const ranked = [...byMint.entries()]
    .map(([mint, v]) => ({ mint, usd: v.usd, heldBy: [...v.heldBy] }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, MAX_LEGS);

  const keptUsd = ranked.reduce((s, r) => s + r.usd, 0) || 1;
  const legs: SquadLeg[] = ranked
    .map((r) => ({
      mint: r.mint,
      symbol: mintSymbol(r.mint),
      weight: r.usd / keptUsd,
      decimals: decimalsFor(r.mint),
      heldBy: r.heldBy,
    }))
    .filter((l) => l.weight >= MIN_LEG_WEIGHT);

  // renormalise after dropping dust legs
  const w = legs.reduce((s, l) => s + l.weight, 0) || 1;
  for (const l of legs) l.weight = l.weight / w;

  const cashPct = totalUsd > 0 ? Math.min(1, Math.max(0, cashUsd / totalUsd)) : 0;
  return {
    legs,
    covered,
    members: members.length,
    lagMs: oldest,
    cashPct,
    deployPct: 1 - cashPct,
  };
}

/** True when we have enough live data to mirror this squad honestly. */
export function squadIsMirrorable(p: SquadPortfolio): { ok: boolean; reason?: string } {
  if (p.members === 0) return { ok: false, reason: "This basket has no trader members." };
  if (p.covered === 0) {
    return { ok: false, reason: "Can't read any member wallet right now — try again shortly." };
  }
  if (p.covered < p.members) {
    return {
      ok: false,
      reason: `Only ${p.covered} of ${p.members} member wallets could be read. Mirroring a partial squad would weight it wrong.`,
    };
  }
  // NOTE: a squad sitting in cash is NOT a reason to refuse. Under the
  // allocation model your pledge simply stays as SOL until they re-enter —
  // that is the strategy running, not a failure. Only genuine READ problems
  // block a mirror, because those would make the weights wrong.
  return { ok: true };
}
