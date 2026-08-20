import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const db = getDb();
  const user = db
    .prepare("SELECT id, email, username, pass_hash, cash FROM users WHERE email = ?")
    .get(email) as { id: number; email: string; username: string; pass_hash: string; cash: number } | undefined;

  if (!user || user.pass_hash.startsWith("!") || !verifyPassword(password, user.pass_hash)) {
    return NextResponse.json(
      { error: user?.pass_hash === "!google!" ? "This account uses Google sign-in" : "Wrong email or password" },
      { status: 401 }
    );
  }

  await createSession(user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, username: user.username, cash: user.cash },
  });
}
