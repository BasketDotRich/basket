import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { custodyConfigured, generateWallet } from "@/lib/custody";


export async function POST(req: Request) {
  let body: { email?: string; username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters (letters, numbers, underscore)" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const db = getDb();
  const taken = db
    .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
    .get(email, username);
  if (taken) {
    return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
  }

  const now = Date.now();
  const wallet = custodyConfigured() ? generateWallet() : null;
  const res = db
    .prepare(
      "INSERT INTO users (email, username, pass_hash, cash, wallet_address, wallet_key, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)"
    )
    .run(
      email,
      username,
      hashPassword(password),
      wallet?.address ?? null,
      wallet?.encryptedKey ?? null,
      now
    );
  const userId = Number(res.lastInsertRowid);
  await createSession(userId);
  return NextResponse.json({ ok: true, user: { id: userId, email, username } });
}
