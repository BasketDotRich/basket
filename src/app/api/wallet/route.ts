import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const db = getDb();
  const transactions = db
    .prepare(
      `SELECT t.id, t.type, t.basket_id, t.amount, t.detail, t.created_at, b.name AS basket_name, b.emoji AS basket_emoji
       FROM transactions t LEFT JOIN baskets b ON b.id = t.basket_id
       WHERE t.user_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 100`
    )
    .all(user.id);
  return NextResponse.json({ cash: user.cash, transactions });
}
