// Near-instant KOL trade detection via Helius enhanced webhooks.
//
// WHY THIS EXISTS: polling wallet balances every 5 minutes is useless for
// copy-trading memecoins — by the time a snapshot diff notices an entry, the
// move is usually over and you are buying the KOL's exit. Helius pushes us the
// parsed transaction within a second or two of it landing, which is the
// difference between mirroring a trade and being exit liquidity for it.
//
// The 5-minute snapshot sweep stays as a SAFETY NET: webhooks can miss events
// (delivery failures, redeploys, unregistered wallets) and the sweep is what
// makes the system self-correcting rather than silently drifting.
import { getDb } from "./db";

const HELIUS_KEY = (() => {
  const url = process.env.HELIUS_RPC_URL ?? "";
  const m = url.match(/api-key=([a-f0-9-]+)/i);
  return m?.[1] ?? process.env.HELIUS_API_KEY?.trim() ?? "";
})();

export const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET?.trim() ?? "";

export function heliusConfigured(): boolean {
  return HELIUS_KEY.length > 10;
}

const API = "https://api.helius.xyz/v0/webhooks";

/**
 * Wallets worth streaming: every trader that sits in a basket somebody could
 * invest in. Registering all 563 would burn the address quota on wallets
 * nobody mirrors.
 */
export function walletsToStream(): { wallet: string; traderId: number }[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.wallet, t.id AS traderId
       FROM traders t
       JOIN basket_traders bt ON bt.trader_id = t.id
       JOIN baskets b ON b.id = bt.basket_id
       WHERE t.wallet IS NOT NULL`
    )
    .all() as { wallet: string; traderId: number }[];
}

type HeliusWebhook = {
  webhookID: string;
  webhookURL: string;
  accountAddresses?: string[];
  transactionTypes?: string[];
};

async function listWebhooks(): Promise<HeliusWebhook[]> {
  const res = await fetch(`${API}?api-key=${HELIUS_KEY}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`helius list ${res.status}`);
  return (await res.json()) as HeliusWebhook[];
}

/**
 * Point a Helius webhook at this deployment for the wallets we actually
 * mirror. Idempotent: reuses our own webhook if one already exists, and never
 * touches webhooks belonging to the account's other projects.
 */
export async function syncHeliusWebhook(
  siteUrl: string
): Promise<{ ok: boolean; webhookID?: string; addresses: number; detail: string }> {
  if (!heliusConfigured()) {
    return { ok: false, addresses: 0, detail: "HELIUS_RPC_URL has no api-key" };
  }
  const targetUrl = `${siteUrl.replace(/\/$/, "")}/api/helius/webhook`;
  const wallets = walletsToStream().map((w) => w.wallet);
  if (wallets.length === 0) {
    return { ok: false, addresses: 0, detail: "no basket-member wallets to stream" };
  }

  const body = {
    webhookURL: targetUrl,
    transactionTypes: ["SWAP"],
    accountAddresses: wallets,
    webhookType: "enhanced",
    ...(HELIUS_WEBHOOK_SECRET ? { authHeader: HELIUS_WEBHOOK_SECRET } : {}),
  };

  try {
    const existing = (await listWebhooks()).find((w) => w.webhookURL === targetUrl);
    const res = await fetch(
      existing ? `${API}/${existing.webhookID}?api-key=${HELIUS_KEY}` : `${API}?api-key=${HELIUS_KEY}`,
      {
        method: existing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }
    );
    const json = (await res.json()) as HeliusWebhook & { error?: string };
    if (!res.ok) {
      return { ok: false, addresses: wallets.length, detail: json.error ?? `http ${res.status}` };
    }
    return {
      ok: true,
      webhookID: json.webhookID,
      addresses: wallets.length,
      detail: existing ? "updated existing webhook" : "created webhook",
    };
  } catch (e) {
    return {
      ok: false,
      addresses: wallets.length,
      detail: e instanceof Error ? e.message : "failed",
    };
  }
}

// ---------- payload parsing ----------

export type HeliusTokenTransfer = {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
  tokenAmount?: number;
};

export type HeliusTx = {
  signature?: string;
  timestamp?: number;
  type?: string;
  tokenTransfers?: HeliusTokenTransfer[];
};

export type DetectedTrade = {
  wallet: string;
  signature: string;
  ts: number;
  mint: string;
  side: "buy" | "sell";
  amount: number;
};

const SOL_LIKE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

/**
 * Turn one enhanced transaction into the trades it represents for the wallets
 * we track. Net per (wallet, mint) so a multi-hop route counts once, and
 * ignore the SOL/stable side — that is the payment, not the position.
 */
export function parseTrades(tx: HeliusTx, tracked: Set<string>): DetectedTrade[] {
  const sig = tx.signature ?? "";
  const ts = (tx.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
  if (!sig) return [];

  const net = new Map<string, number>(); // `${wallet}|${mint}` -> signed amount
  for (const t of tx.tokenTransfers ?? []) {
    const mint = t.mint;
    const amt = t.tokenAmount;
    if (!mint || !Number.isFinite(amt) || !amt || SOL_LIKE.has(mint)) continue;
    if (t.toUserAccount && tracked.has(t.toUserAccount)) {
      const k = `${t.toUserAccount}|${mint}`;
      net.set(k, (net.get(k) ?? 0) + amt!);
    }
    if (t.fromUserAccount && tracked.has(t.fromUserAccount)) {
      const k = `${t.fromUserAccount}|${mint}`;
      net.set(k, (net.get(k) ?? 0) - amt!);
    }
  }

  const out: DetectedTrade[] = [];
  for (const [k, amount] of net) {
    if (amount === 0) continue;
    const [wallet, mint] = k.split("|");
    out.push({
      wallet,
      signature: sig,
      ts,
      mint,
      side: amount > 0 ? "buy" : "sell",
      amount: Math.abs(amount),
    });
  }
  return out;
}

/**
 * Persist a detected trade. Returns false when it was already recorded — the
 * webhook and the snapshot sweep both feed this path, so the signature is the
 * idempotency key that keeps them from double-counting the same trade.
 */
export function recordDetectedTrade(t: DetectedTrade, traderId: number, symbol: string, usd: number): boolean {
  const db = getDb();
  const dupe = db
    .prepare("SELECT 1 FROM wallet_events WHERE trader_id = ? AND mint = ? AND ts = ? LIMIT 1")
    .get(traderId, t.mint, t.ts);
  if (dupe) return false;
  db.prepare(
    "INSERT INTO wallet_events (trader_id, ts, mint, symbol, delta_usd, kind) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(traderId, t.ts, t.mint, symbol, t.side === "buy" ? usd : -usd, t.side);
  return true;
}
