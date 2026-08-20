import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { TradingError, getAccountHoldings } from "@/lib/trading";

/** The account wallet's on-chain token holdings, priced. Never exposes keys. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const holdings = await getAccountHoldings(user.id);
    return NextResponse.json({ holdings });
  } catch (e) {
    if (e instanceof TradingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("holdings failed", e);
    return NextResponse.json({ error: "Couldn't load holdings" }, { status: 500 });
  }
}
