import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getPortfolio, getSnapshots, recordSnapshot } from "@/lib/portfolio";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await recordSnapshot(user.id);
  const portfolio = await getPortfolio(user.id);
  const snapshots = getSnapshots(user.id);

  // Standing squad allocations are real commitments even when nothing is
  // deployed yet. Leaving them out is why a funded account could read
  // "No positions yet" — which made people fund it again.
  let allocations: {
    basketId: number;
    name: string;
    pledgedSol: number;
    deployedSol: number;
    idleSol: number;
  }[] = [];
  try {
    const { getDb } = await import("@/lib/db");
    const { solPriceUsd } = await import("@/lib/treasury");
    const px = (await solPriceUsd()) ?? 0;
    const rows = getDb()
      .prepare(
        `SELECT th.basket_id, th.allocated_lamports, b.name
         FROM trader_holdings th JOIN baskets b ON b.id = th.basket_id
         WHERE th.user_id = ? AND th.allocated_lamports > 0`
      )
      .all(user.id) as { basket_id: number; allocated_lamports: number; name: string }[];
    allocations = rows.map((r) => {
      const deployedUsd = (getDb()
        .prepare("SELECT COALESCE(SUM(cost),0) AS c FROM holdings WHERE user_id = ? AND basket_id = ?")
        .get(user.id, r.basket_id) as { c: number }).c;
      const deployedSol = px > 0 ? deployedUsd / px : 0;
      const pledgedSol = r.allocated_lamports / 1e9;
      return {
        basketId: r.basket_id,
        name: r.name,
        pledgedSol,
        deployedSol,
        idleSol: Math.max(0, pledgedSol - deployedSol),
      };
    });
  } catch {
    /* additive */
  }

  return NextResponse.json({ ...portfolio, snapshots, allocations });
}
