import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { SITE_URL, setCommands, setWebhook, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Register the webhook + command menu with Telegram. Sign-in required: this is
 * an operator action, not a public endpoint.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 503 });
  }
  const url = `${SITE_URL.replace(/\/$/, "")}/api/telegram/webhook`;
  const hook = await setWebhook(url);
  const commands = await setCommands();
  return NextResponse.json({ webhook: hook, commandsRegistered: commands, url });
}
