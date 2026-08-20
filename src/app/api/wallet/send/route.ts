import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { withdrawSol } from "@/lib/accounts";

// Simple per-user throttle so a leaked session can't drain in a tight loop.
declare global {
  // eslint-disable-next-line no-var
  var __bWithdrawGuard: Map<number, number> | undefined;
}
const guard = (globalThis.__bWithdrawGuard ??= new Map());
const MIN_GAP_MS = 5_000;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const last = guard.get(user.id) ?? 0;
  if (Date.now() - last < MIN_GAP_MS) {
    return NextResponse.json({ error: "Slow down a moment and try again" }, { status: 429 });
  }
  guard.set(user.id, Date.now());

  let body: { destination?: string; amountSol?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const { signature } = await withdrawSol(
      user.id,
      (body.destination ?? "").trim(),
      Number(body.amountSol)
    );
    return NextResponse.json({ ok: true, signature });
  } catch (e) {
    if (e instanceof CustodyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("withdraw failed", e instanceof Error ? e.message : "unknown");
    return NextResponse.json(
      { error: "Withdrawal could not be sent — try again shortly" },
      { status: 500 }
    );
  }
}
