import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { CURATED_TOKENS } from "./tokens";

declare global {
  // eslint-disable-next-line no-var
  var __mbDb: DatabaseSync | undefined;
}

const SYSTEM_EMAIL = "system@basket.rich";

function createDb(): DatabaseSync {
  // DATA_DIR lets production mount a persistent volume (e.g. /data on Railway)
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "basket.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    -- Every account gets a real Solana wallet at signup. wallet_key holds the
    -- AES-256-GCM encrypted secret (see lib/custody.ts); it is never returned
    -- by any API and never logged.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      cash REAL NOT NULL DEFAULT 0,
      wallet_address TEXT,
      wallet_key TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    -- tracked=1 means the mint is part of the global wallet-tracking universe
    -- (curated tokens only). User-added basket tokens are stored as metadata
    -- with tracked=0 so a stranger cannot widen every trader basket's NAV.
    CREATE TABLE IF NOT EXISTS token_meta (
      mint TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      decimals INTEGER NOT NULL DEFAULT 6,
      coingecko_id TEXT,
      tracked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS baskets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'coin', -- 'coin' | 'trader'
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🧺',
      horizon TEXT, -- 'short' | 'long' | NULL — creator's stated intent
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    -- Per-position exit automation, set at invest time. Checked every minute
    -- against LIVE valuations; triggering auto-redeems the full position.
    CREATE TABLE IF NOT EXISTS position_rules (
      user_id INTEGER NOT NULL REFERENCES users(id),
      basket_id INTEGER NOT NULL REFERENCES baskets(id),
      tp_pct REAL,          -- take-profit: redeem when PnL% >= tp_pct
      sl_pct REAL,          -- stop-loss:  redeem when PnL% <= -sl_pct
      close_at INTEGER,     -- auto-close: redeem at/after this timestamp
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, basket_id)
    );
    CREATE TABLE IF NOT EXISTS basket_tokens (
      basket_id INTEGER NOT NULL REFERENCES baskets(id),
      mint TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (basket_id, mint)
    );
    -- Real tracked wallets. seed_stats: JSON snapshot of the public Kolscan
    -- leaderboard stats ({daily,weekly,monthly:{profit,wins,losses}, asOf}).
    -- listed=1 marks wallets that appear on Kolscan's public leaderboard.
    CREATE TABLE IF NOT EXISTS traders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      wallet TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL DEFAULT 'memecoin trader',
      bio TEXT NOT NULL DEFAULT '',
      twitter TEXT,
      pfp TEXT,
      listed INTEGER NOT NULL DEFAULT 0,
      source_url TEXT,
      seed_stats TEXT,
      added_by INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS basket_traders (
      basket_id INTEGER NOT NULL REFERENCES baskets(id),
      trader_id INTEGER NOT NULL REFERENCES traders(id),
      weight REAL NOT NULL,
      baseline_value REAL, -- wallet USD value when first observed after basket creation
      PRIMARY KEY (basket_id, trader_id)
    );
    -- Real on-chain wallet value snapshots (the trader equity curves).
    -- holdings: JSON of the top tracked positions at snapshot time, used to
    -- detect position changes between snapshots.
    CREATE TABLE IF NOT EXISTS wallet_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trader_id INTEGER NOT NULL REFERENCES traders(id),
      ts INTEGER NOT NULL,
      value REAL NOT NULL,
      sol REAL NOT NULL DEFAULT 0,
      holdings TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wsnap ON wallet_snapshots(trader_id, ts);
    -- Position changes detected between consecutive snapshots (~5min resolution).
    CREATE TABLE IF NOT EXISTS wallet_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trader_id INTEGER NOT NULL REFERENCES traders(id),
      ts INTEGER NOT NULL,
      mint TEXT NOT NULL,
      symbol TEXT NOT NULL,
      delta_usd REAL NOT NULL,
      kind TEXT NOT NULL -- 'buy' | 'sell'
    );
    CREATE INDEX IF NOT EXISTS idx_wevents ON wallet_events(ts DESC);
    -- coin-basket positions: token quantities bought at live prices
    CREATE TABLE IF NOT EXISTS holdings (
      user_id INTEGER NOT NULL REFERENCES users(id),
      basket_id INTEGER NOT NULL REFERENCES baskets(id),
      mint TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, basket_id, mint)
    );
    -- trader-basket positions: units of the basket's NAV index
    CREATE TABLE IF NOT EXISTS trader_holdings (
      user_id INTEGER NOT NULL REFERENCES users(id),
      basket_id INTEGER NOT NULL REFERENCES baskets(id),
      units REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, basket_id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL, -- deposit|withdraw|invest|redeem
      basket_id INTEGER,
      amount REAL NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      ts INTEGER NOT NULL,
      value REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
    -- Protocol treasury ledger. Every fee in and every burn out, itemised.
    -- amount_usd: + = inflow to treasury, − = outflow (burned).
    -- Pre-launch this is an ACCRUAL ledger: it records exactly what is owed to
    -- buyback-and-burn; on-chain execution is wired at launch (see /treasury).
    CREATE TABLE IF NOT EXISTS treasury_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL, -- performance_fee | creation_fee | treasury_pnl | burn
      amount_usd REAL NOT NULL,
      amount_sol REAL,
      user_id INTEGER REFERENCES users(id),
      basket_id INTEGER REFERENCES baskets(id),
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_treasury_ts ON treasury_ledger(ts DESC);
  `);
  seed(db);
  return db;
}

// Full Kolscan public leaderboard roster (98 wallets), extracted 2026-08-20:
// name, wallet, twitter, and daily/weekly/monthly profit + W/L per trader.
// PFPs resolve live from each trader's own Twitter avatar via unavatar.io.
import kolsJson from "@/data/kols.json";

const KOLSCAN_URL = "https://kolscan.io/leaderboard";
const KOLSCAN_DATE = "2026-08-20";

type KolStats = { profit: number; wins: number; losses: number };
type KolEntry = {
  wallet: string;
  name: string | null;
  twitter: string | null;
  telegram?: string | null;
  handle: string | null;
  pfp: string | null;
  stats: { daily?: KolStats; weekly?: KolStats; monthly?: KolStats };
};
const KOLS = (kolsJson as unknown as KolEntry[]).filter((k) => k.name);

function kolLabel(k: KolEntry): string {
  const m = k.stats.monthly;
  const trades = m ? m.wins + m.losses : 0;
  if (trades >= 1500) return "high-frequency";
  if (trades >= 500) return "active";
  if (trades >= 100) return "regular";
  return "selective";
}

function seed(db: DatabaseSync) {
  for (const t of CURATED_TOKENS) {
    db.prepare(
      `INSERT INTO token_meta (mint, symbol, name, icon, decimals, coingecko_id, tracked)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(mint) DO UPDATE SET symbol=excluded.symbol, name=excluded.name,
         icon=excluded.icon, decimals=excluded.decimals, coingecko_id=excluded.coingecko_id,
         tracked=1`
    ).run(t.mint, t.symbol, t.name, t.icon, t.decimals, t.coingeckoId);
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(SYSTEM_EMAIL) as
    | { id: number }
    | undefined;
  if (existing) return;

  // atomic: a mid-seed crash must not leave the sentinel row without the data
  db.exec("BEGIN IMMEDIATE");
  try {
    seedContent(db);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function seedContent(db: DatabaseSync) {
  const now = Date.now();
  const sys = db
    .prepare("INSERT INTO users (email, username, pass_hash, cash, created_at) VALUES (?, ?, ?, 0, ?)")
    .run(SYSTEM_EMAIL, "basket", "!locked!", now);
  const sysId = Number(sys.lastInsertRowid);

  const mkBasket = (kind: "coin" | "trader", name: string, emoji: string, description: string): number => {
    const r = db
      .prepare(
        "INSERT INTO baskets (owner_id, kind, name, description, emoji, is_public, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
      )
      .run(sysId, kind, name, description, emoji, now);
    return Number(r.lastInsertRowid);
  };

  const bySymbol = Object.fromEntries(CURATED_TOKENS.map((t) => [t.symbol, t.mint]));
  const addTokens = (basketId: number, weights: [string, number][]) => {
    const total = weights.reduce((s, [, w]) => s + w, 0);
    for (const [sym, w] of weights) {
      const mint = bySymbol[sym];
      if (!mint) continue;
      db.prepare("INSERT INTO basket_tokens (basket_id, mint, weight) VALUES (?, ?, ?)").run(
        basketId, mint, w / total
      );
    }
  };

  // Genre index presets over the pump.fun-only universe. Weighting follows
  // the GMCI pattern: capped weighting, 25-35% max per asset.
  addTokens(
    mkBasket("coin", "Pump Majors", "🏆",
      "The largest pump.fun graduates by market cap — ANSEM, FARTCOIN, JELLYJELLY, ARC, BAN."),
    [["ANSEM", 25], ["FARTCOIN", 25], ["JELLYJELLY", 20], ["ARC", 15], ["BAN", 15]]
  );
  addTokens(
    mkBasket("coin", "AI Agents Index", "🤖",
      "Agent-born graduates: Truth-Terminal lore, agent frameworks, autonomous creators."),
    [["FARTCOIN", 25], ["ARC", 20], ["GOAT", 15], ["ALCH", 15], ["PIPPIN", 15], ["ACT", 10]]
  );
  addTokens(
    mkBasket("coin", "Zoo & Dogs", "🦛",
      "The animal wing of the launchpad: the hippo, the squirrel, the Pomeranian and the chill dog."),
    [["MOODENG", 30], ["PNUT", 30], ["BERT", 20], ["CHILLGUY", 20]]
  );
  addTokens(
    mkBasket("coin", "Chan Culture", "🗿",
      "Sigma lore and financial nihilism: GIGACHAD, NEET, Buttcoin, Fartboy."),
    [["GIGA", 30], ["NEET", 30], ["BUTTCOIN", 20], ["FARTBOY", 20]]
  );
  addTokens(
    mkBasket("coin", "Celebrity & IP", "🎬",
      "Real people and real artifacts on-chain: Ansem's bull, the $6.2M banana, Vine, unicorn fart dust and Jelly-My-Jelly."),
    [["ANSEM", 25], ["BAN", 25], ["JELLYJELLY", 20], ["VINE", 15], ["UFD", 15]]
  );
  addTokens(
    mkBasket("coin", "2024 Class", "🎖️",
      "The pump.fun breakout class of 2024 — the coins that built the launchpad era."),
    [["MOODENG", 20], ["GOAT", 20], ["GIGA", 20], ["ACT", 20], ["CHILLGUY", 20]]
  );
  addTokens(
    mkBasket("coin", "Fresh 2026", "⚡",
      "This cycle's young breakouts: ANSEM, MANIFEST, Buttcoin, UWU. Higher risk, faster rotation."),
    [["ANSEM", 35], ["MANIFEST", 25], ["BUTTCOIN", 20], ["UWU", 20]]
  );

  // Seed the entire Kolscan roster — every wallet selectable in the builder.
  const traderIds = new Map<string, number>();
  for (const k of KOLS) {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO traders (name, wallet, label, bio, twitter, pfp, listed, source_url, seed_stats, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      )
      .run(
        (k.name ?? k.wallet.slice(0, 8)).slice(0, 40),
        k.wallet,
        kolLabel(k),
        k.stats.monthly
          ? `On Kolscan's public leaderboard (${KOLSCAN_DATE} snapshot).`
          : `Kolscan directory member (${KOLSCAN_DATE} snapshot).`,
        k.twitter,
        k.pfp,
        KOLSCAN_URL,
        JSON.stringify({ ...k.stats, asOf: KOLSCAN_DATE }),
        sysId,
        now
      );
    if (r.lastInsertRowid) traderIds.set(k.wallet, Number(r.lastInsertRowid));
  }

  const addTraders = (basketId: number, weights: [string, number][]) => {
    const total = weights.reduce((s, [, w]) => s + w, 0);
    for (const [wallet, w] of weights) {
      const id = traderIds.get(wallet);
      if (!id) continue;
      db.prepare(
        "INSERT INTO basket_traders (basket_id, trader_id, weight, baseline_value) VALUES (?, ?, ?, NULL)"
      ).run(basketId, id, w / total);
    }
  };

  // Presets computed from the real monthly stats, weights ∝ metric (30% cap).
  const withMonthly = KOLS.filter((k) => k.stats.monthly);
  const capWeights = (list: { k: KolEntry; metric: number }[]): [string, number][] => {
    const total = list.reduce((s, x) => s + x.metric, 0) || 1;
    return list.map((x) => [x.k.wallet, Math.min(x.metric / total, 0.3)] as [string, number]);
  };

  const topPnl = [...withMonthly]
    .sort((a, b) => b.stats.monthly!.profit - a.stats.monthly!.profit)
    .slice(0, 5)
    .map((k) => ({ k, metric: Math.max(k.stats.monthly!.profit, 1) }));
  addTraders(
    mkBasket("trader", "Monthly Top Five", "🥇",
      `The five most profitable wallets on Kolscan's monthly board (${KOLSCAN_DATE}): ${topPnl.map((x) => x.k.name).join(", ")}. PnL-weighted.`),
    capWeights(topPnl)
  );

  const volumeKings = [...withMonthly]
    .sort((a, b) => (b.stats.monthly!.wins + b.stats.monthly!.losses) - (a.stats.monthly!.wins + a.stats.monthly!.losses))
    .slice(0, 5)
    .map((k) => ({ k, metric: 1 }));
  addTraders(
    mkBasket("trader", "Volume Kings", "⚔️",
      `The highest-activity trench wallets by monthly trade count: ${volumeKings.map((x) => x.k.name).join(", ")}. Equal weight.`),
    capWeights(volumeKings)
  );

  const sharp = withMonthly
    .filter((k) => k.stats.monthly!.wins + k.stats.monthly!.losses >= 100 && k.stats.monthly!.profit > 0)
    .sort(
      (a, b) =>
        b.stats.monthly!.wins / (b.stats.monthly!.wins + b.stats.monthly!.losses) -
        a.stats.monthly!.wins / (a.stats.monthly!.wins + a.stats.monthly!.losses)
    )
    .slice(0, 5)
    .map((k) => ({ k, metric: 1 }));
  addTraders(
    mkBasket("trader", "Sharp Shooters", "🎯",
      `Best monthly win rates among wallets with 100+ trades: ${sharp.map((x) => x.k.name).join(", ")}. Equal weight.`),
    capWeights(sharp)
  );
}

export function getDb(): DatabaseSync {
  if (!globalThis.__mbDb) {
    globalThis.__mbDb = createDb();
  }
  return globalThis.__mbDb;
}

export const SYSTEM_USERNAME = "basket";
