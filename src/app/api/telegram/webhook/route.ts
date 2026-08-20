import { NextResponse } from "next/server";
import { WEBHOOK_SECRET, answerCallback, telegramConfigured } from "@/lib/telegram";
import { handleCommand } from "@/lib/telegram-commands";

export const dynamic = "force-dynamic";

type Update = {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
    from?: { username?: string };
  };
};

/**
 * Telegram webhook. Always answers 200 quickly — Telegram retries non-200s,
 * which would replay commands. Work is awaited but errors are swallowed into
 * a 200 so a transient failure can't cause a retry storm.
 */
export async function POST(req: Request) {
  if (!telegramConfigured()) {
    return NextResponse.json({ ok: true });
  }
  // Shared-secret header proves the caller is Telegram, not a stranger who
  // guessed the URL. FAIL CLOSED: a configured bot with no secret would let
  // anyone drive commands for any chat id, so refuse rather than run open.
  if (!WEBHOOK_SECRET) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set — refusing webhook traffic");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.message?.text) {
      await handleCommand(
        update.message.chat.id,
        update.message.text,
        update.message.from?.username ?? null
      );
    } else if (update.callback_query) {
      const q = update.callback_query;
      await answerCallback(q.id);
      if (q.data && q.message) {
        await handleCommand(q.message.chat.id, `/${q.data}`, q.from?.username ?? null);
      }
    }
  } catch (e) {
    console.error("telegram update failed", e);
  }
  return NextResponse.json({ ok: true });
}
