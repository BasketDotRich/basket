import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { googleEnabled, googleExchangeCode } from "@/lib/google";
import { custodyConfigured, generateWallet } from "@/lib/custody";


function usernameFromEmail(db: ReturnType<typeof getDb>, email: string): string {
  const base =
    email
      .split("@")[0]
      .replace(/[^a-zA-Z0-9_]/g, "")
      .slice(0, 16) || "trader";
  let candidate = base;
  for (let i = 2; i < 100; i++) {
    const taken = db.prepare("SELECT id FROM users WHERE username = ?").get(candidate);
    if (!taken) return candidate;
    candidate = `${base}${i}`;
  }
  return `${base}${Date.now() % 10000}`;
}

export async function GET(req: Request) {
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, req.url));
  if (!googleEnabled()) return fail("google-unconfigured");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("mb_oauth_state")?.value;
  jar.delete("mb_oauth_state");
  if (!code || !state || !expected || state !== expected) return fail("google-state");

  const profile = await googleExchangeCode(code);
  if (!profile || !profile.emailVerified) return fail("google-denied");

  const db = getDb();
  let user = db.prepare("SELECT id FROM users WHERE email = ?").get(profile.email) as
    | { id: number }
    | undefined;
  if (!user) {
    const username = usernameFromEmail(db, profile.email);
    const now = Date.now();
    const wallet = custodyConfigured() ? generateWallet() : null;
    const res = db
      .prepare(
        "INSERT INTO users (email, username, pass_hash, cash, wallet_address, wallet_key, created_at) VALUES (?, ?, '!google!', 0, ?, ?, ?)"
      )
      .run(
        profile.email,
        username,
        wallet?.address ?? null,
        wallet?.encryptedKey ?? null,
        now
      );
    const userId = Number(res.lastInsertRowid);
    user = { id: userId };
  }
  await createSession(user.id);
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
