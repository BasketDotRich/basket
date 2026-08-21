import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { publicOrigin } from "@/lib/google";
import { heliusConfigured, syncHeliusWebhook, walletsToStream } from "@/lib/helius-webhook";

export const dynamic = "force-dynamic";

/** Which wallets we would stream, without changing anything. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json({
    configured: heliusConfigured(),
    wallets: walletsToStream().length,
    target: `${publicOrigin(req)}/api/helius/webhook`,
  });
}

/**
 * Register (or update) the Helius webhook for basket-member wallets.
 * Operator action — sign-in required.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const result = await syncHeliusWebhook(publicOrigin(req));
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
