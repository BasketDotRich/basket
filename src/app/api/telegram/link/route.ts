import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import {
  BOT_USERNAME,
  createLinkCode,
  getLinkByUser,
  telegramConfigured,
} from "@/lib/telegram";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Current link status for the signed-in account. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const link = getLinkByUser(user.id);
  return NextResponse.json({
    configured: telegramConfigured(),
    botUsername: BOT_USERNAME || null,
    linked: link
      ? { username: link.username, linkedAt: link.linked_at, alertsOn: link.alerts_on === 1 }
      : null,
  });
}

/** Mint a fresh single-use link code (proves account ownership). */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram bot isn't configured yet" }, { status: 503 });
  }
  const { code, expiresAt } = createLinkCode(user.id);
  return NextResponse.json({
    code,
    expiresAt,
    botUsername: BOT_USERNAME || null,
    deepLink: BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=${code}` : null,
  });
}

/** Disconnect Telegram from this account. */
export async function DELETE() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  getDb().prepare("DELETE FROM telegram_links WHERE user_id = ?").run(user.id);
  return NextResponse.json({ ok: true });
}
