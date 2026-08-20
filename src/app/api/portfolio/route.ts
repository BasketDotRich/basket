import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getPortfolio, getSnapshots, recordSnapshot } from "@/lib/portfolio";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await recordSnapshot(user.id);
  const portfolio = await getPortfolio(user.id);
  const snapshots = getSnapshots(user.id);
  return NextResponse.json({ ...portfolio, snapshots });
}
