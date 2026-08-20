// Telegram bot: read-only companion to the web app.
//
// SECURITY MODEL — deliberate and load-bearing:
//   • The bot NEVER moves funds. No buy, no sell, no withdraw, no key access.
//     A compromised Telegram account can read a portfolio, nothing more.
//   • Linking requires a single-use code minted while signed in on the site,
//     so knowing a chat id (or guessing a username) can never claim an account.
//   • Wallet secrets are never read here — this module has no custody import.
import { getDb } from "./db";

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
export const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
export const SITE_URL = process.env.SITE_URL?.trim() ?? "https://basket.rich";

export function telegramConfigured(): boolean {
  return BOT_TOKEN.length > 20;
}

const API = (method: string) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

export type InlineButton = { text: string; url?: string; callback_data?: string };

/** Send a message. Never throws — a failed send must not break a trade tick. */
export async function sendMessage(
  chatId: number,
  text: string,
  opts: { buttons?: InlineButton[][]; silent?: boolean } = {}
): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(API("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        disable_notification: opts.silent ?? false,
        ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Acknowledge a button tap so the client stops showing a spinner. */
export async function answerCallback(id: string, text?: string): Promise<void> {
  if (!telegramConfigured()) return;
  try {
    await fetch(API("answerCallbackQuery"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, ...(text ? { text } : {}) }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* non-fatal */
  }
}

export async function setWebhook(url: string): Promise<{ ok: boolean; description?: string }> {
  if (!telegramConfigured()) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(API("setWebhook"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: WEBHOOK_SECRET || undefined,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as { ok: boolean; description?: string };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : "failed" };
  }
}

/** Register the command list so Telegram shows the "/" menu. */
export async function setCommands(): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const commands = [
    { command: "start", description: "Link your account and get going" },
    { command: "portfolio", description: "Your positions, value and P&L" },
    { command: "wallet", description: "Wallet balance and deposit address" },
    { command: "baskets", description: "Browse live baskets" },
    { command: "rules", description: "Your armed take-profit / stop-loss" },
    { command: "kols", description: "Top tracked KOL wallets today" },
    { command: "alerts", description: "Turn exit alerts on or off" },
    { command: "help", description: "What this bot can do" },
  ];
  try {
    const res = await fetch(API("setMyCommands"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- account linking ----------

export type TelegramLink = {
  chat_id: number;
  user_id: number;
  username: string | null;
  linked_at: number;
  alerts_on: number;
};

const CODE_TTL_MS = 15 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes

/** Mint a single-use link code for a signed-in user. */
export function createLinkCode(userId: number): { code: string; expiresAt: number } {
  const db = getDb();
  db.prepare("DELETE FROM telegram_codes WHERE user_id = ? OR expires_at < ?").run(
    userId,
    Date.now()
  );
  const { randomInt } = require("node:crypto") as typeof import("node:crypto");
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const expiresAt = Date.now() + CODE_TTL_MS;
  db.prepare("INSERT INTO telegram_codes (code, user_id, expires_at) VALUES (?, ?, ?)").run(
    code,
    userId,
    expiresAt
  );
  return { code, expiresAt };
}

/** Redeem a link code from a Telegram chat. Single-use, time-boxed. */
export function redeemLinkCode(
  code: string,
  chatId: number,
  username: string | null
): { ok: true; userId: number } | { ok: false; error: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT code, user_id, expires_at, used_at FROM telegram_codes WHERE code = ?")
    .get(code.trim().toUpperCase()) as
    | { code: string; user_id: number; expires_at: number; used_at: number | null }
    | undefined;
  if (!row) return { ok: false, error: "That code isn't valid. Generate a fresh one on the site." };
  if (row.used_at != null) return { ok: false, error: "That code was already used." };
  if (Date.now() > row.expires_at) return { ok: false, error: "That code expired. Generate a new one." };

  db.exec("BEGIN");
  try {
    // One account per chat, one chat per account — re-linking replaces cleanly.
    db.prepare("DELETE FROM telegram_links WHERE chat_id = ? OR user_id = ?").run(chatId, row.user_id);
    db.prepare(
      "INSERT INTO telegram_links (chat_id, user_id, username, linked_at, alerts_on) VALUES (?, ?, ?, ?, 1)"
    ).run(chatId, row.user_id, username, Date.now());
    db.prepare("UPDATE telegram_codes SET used_at = ? WHERE code = ?").run(Date.now(), row.code);
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
    return { ok: false, error: "Could not link right now — try again." };
  }
  return { ok: true, userId: row.user_id };
}

export function getLinkByChat(chatId: number): TelegramLink | null {
  return (
    (getDb()
      .prepare("SELECT * FROM telegram_links WHERE chat_id = ?")
      .get(chatId) as TelegramLink | undefined) ?? null
  );
}

export function getLinkByUser(userId: number): TelegramLink | null {
  return (
    (getDb()
      .prepare("SELECT * FROM telegram_links WHERE user_id = ?")
      .get(userId) as TelegramLink | undefined) ?? null
  );
}

export function unlinkChat(chatId: number): void {
  getDb().prepare("DELETE FROM telegram_links WHERE chat_id = ?").run(chatId);
}

export function setAlerts(chatId: number, on: boolean): void {
  getDb().prepare("UPDATE telegram_links SET alerts_on = ? WHERE chat_id = ?").run(on ? 1 : 0, chatId);
}

// ---------- alert delivery (deduped) ----------

/**
 * Send an alert at most once per (chat, kind, key). The dedupe row is written
 * BEFORE the send: a duplicate is a worse failure than a missed retry, because
 * users judge a bot by whether it spams them.
 */
export async function sendAlertOnce(
  chatId: number,
  kind: string,
  dedupeKey: string,
  text: string,
  buttons?: InlineButton[][]
): Promise<boolean> {
  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO telegram_sent (chat_id, kind, dedupe_key, ts) VALUES (?, ?, ?, ?)"
    ).run(chatId, kind, dedupeKey, Date.now());
  } catch {
    return false; // unique constraint → already sent
  }
  return sendMessage(chatId, text, { buttons });
}

/** Notify a user by account id, if they linked a chat and want alerts. */
export async function alertUser(
  userId: number,
  kind: string,
  dedupeKey: string,
  text: string,
  buttons?: InlineButton[][]
): Promise<void> {
  if (!telegramConfigured()) return;
  const link = getLinkByUser(userId);
  if (!link || link.alerts_on !== 1) return;
  await sendAlertOnce(link.chat_id, kind, dedupeKey, text, buttons);
}

// ---------- formatting ----------

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function money(n: number): string {
  const abs = Math.abs(n);
  const s =
    abs >= 1_000_000 ? `$${(abs / 1e6).toFixed(2)}M`
    : abs >= 1_000 ? `$${(abs / 1e3).toFixed(1)}K`
    : abs >= 1 ? `$${abs.toFixed(2)}`
    : `$${abs.toFixed(abs >= 0.01 ? 4 : 6)}`;
  return n < 0 ? `-${s}` : s;
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const arrow = n > 0.01 ? "🟢" : n < -0.01 ? "🔴" : "⚪";
  return `${arrow} ${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
