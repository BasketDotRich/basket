import { NextResponse } from "next/server";
import { getBasket } from "@/lib/portfolio";
import { getSquadPortfolio, squadIsMirrorable } from "@/lib/squad";

export const dynamic = "force-dynamic";

/**
 * The live portfolio a trader basket mirrors — exactly what your own wallet
 * buys when you invest. Public: it is the basket's composition, not anyone's
 * personal position.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const basket = getBasket(Number(id));
  if (!basket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (basket.kind !== "trader") {
    return NextResponse.json({ error: "Not a trader basket" }, { status: 400 });
  }
  const squad = await getSquadPortfolio(basket.id);
  const check = squadIsMirrorable(squad);
  return NextResponse.json({ ...squad, mirrorable: check.ok, reason: check.reason ?? null });
}
