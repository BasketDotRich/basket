import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { InvestError, UnpricedLegsError, redeemFromBasket } from "@/lib/portfolio";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { id } = await ctx.params;
  let body: { fraction?: number; allowUnpriced?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const proceeds = await redeemFromBasket(user.id, Number(id), Number(body.fraction), undefined, {
      allowUnpriced: body.allowUnpriced === true,
    });
    return NextResponse.json({ ok: true, proceeds });
  } catch (e) {
    if (e instanceof UnpricedLegsError) {
      // 409: the client can retry with allowUnpriced to write these legs off
      return NextResponse.json(
        {
          error: `No live price for ${e.symbols.join(", ")}`,
          unpriced: e.symbols,
          canWriteOff: true,
        },
        { status: 409 }
      );
    }
    if (e instanceof InvestError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("redeem failed", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
