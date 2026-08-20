import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { InvestError, investInBasket, setPositionRule } from "@/lib/portfolio";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { id } = await ctx.params;
  let body: { amount?: number; tpPct?: number | null; slPct?: number | null; closeDays?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // An omitted field means "leave the stored rule alone" (see setPositionRule's
  // three-state contract) — mapping it to null here would silently disarm rules
  // the user already has. Clearing is DELETE /api/baskets/[id]/rules only.
  const tpPct = body.tpPct ?? undefined;
  const slPct = body.slPct ?? undefined;
  const closeDays = body.closeDays ?? undefined;
  const hasRules = tpPct !== undefined || slPct !== undefined || closeDays !== undefined;

  try {
    // Validate rules BEFORE moving money, so a bad rule can't leave the user
    // invested with an error that reads like the invest itself failed.
    if (hasRules) setPositionRule(user.id, Number(id), { tpPct, slPct, closeDays }, { dryRun: true });
    await investInBasket(user.id, Number(id), Number(body.amount));
    if (hasRules) setPositionRule(user.id, Number(id), { tpPct, slPct, closeDays });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof InvestError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("invest failed", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
