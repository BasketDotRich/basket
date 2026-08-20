import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { recordSnapshot } from "@/lib/portfolio";

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    return NextResponse.json({ error: "Minimum withdrawal is $1" }, { status: 400 });
  }
  const db = getDb();
  // atomic conditional decrement — safe against concurrent withdrawals
  const res = db
    .prepare("UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ? - 1e-9")
    .run(amount, user.id, amount);
  if (res.changes === 0) {
    return NextResponse.json({ error: "Not enough available cash" }, { status: 400 });
  }
  db.prepare(
    "INSERT INTO transactions (user_id, type, amount, detail, created_at) VALUES (?, 'withdraw', ?, 'Practice balance withdrawal', ?)"
  ).run(user.id, amount, Date.now());
  await recordSnapshot(user.id, true);
  const updated = db.prepare("SELECT cash FROM users WHERE id = ?").get(user.id) as { cash: number };
  return NextResponse.json({ ok: true, cash: updated.cash });
}
