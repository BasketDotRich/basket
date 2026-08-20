import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { InvestError, clearPositionRule, setPositionRule } from "@/lib/portfolio";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  let body: { tpPct?: number | null; slPct?: number | null; closeDays?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    // Pass fields through untouched: an omitted field ("undefined") preserves
    // the stored value, an explicit null clears it — see setPositionRule.
    setPositionRule(user.id, Number(id), {
      tpPct: "tpPct" in body ? body.tpPct : undefined,
      slPct: "slPct" in body ? body.slPct : undefined,
      closeDays: "closeDays" in body ? body.closeDays : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof InvestError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  clearPositionRule(user.id, Number(id));
  return NextResponse.json({ ok: true });
}
