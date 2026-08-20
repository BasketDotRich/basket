import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { recordSnapshot } from "@/lib/portfolio";

const MAX_DEPOSIT = 1_000_000;

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
    return NextResponse.json({ error: "Minimum deposit is $1" }, { status: 400 });
  }
  if (amount > MAX_DEPOSIT) {
    return NextResponse.json(
      { error: `Maximum single deposit is $${MAX_DEPOSIT.toLocaleString()}` },
      { status: 400 }
    );
  }

  const db = getDb();
  db.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").run(amount, user.id);
  db.prepare(
    "INSERT INTO transactions (user_id, type, amount, detail, created_at) VALUES (?, 'deposit', ?, 'Practice balance top-up', ?)"
  ).run(user.id, amount, Date.now());
  await recordSnapshot(user.id, true);
  const updated = db.prepare("SELECT cash FROM users WHERE id = ?").get(user.id) as { cash: number };
  return NextResponse.json({ ok: true, cash: updated.cash });
}
