import { NextResponse } from "next/server";
import { rpcUrl } from "@/lib/swap";

// Narrow RPC proxy so the browser never sees the Helius key.
// Only the methods a signing client legitimately needs are forwarded.
const ALLOWED = new Set([
  "getLatestBlockhash",
  "sendTransaction",
  "getSignatureStatuses",
  "getBalance",
  "getAccountInfo",
  "getFeeForMessage",
  "simulateTransaction",
  "getEpochInfo",
  "getSlot",
  "getMinimumBalanceForRentExemption",
  "getTokenAccountsByOwner",
]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 10) {
    return NextResponse.json({ error: "Batch too large" }, { status: 400 });
  }
  for (const c of calls) {
    const method = (c as { method?: string })?.method;
    if (typeof method !== "string" || !ALLOWED.has(method)) {
      return NextResponse.json({ error: `Method not allowed: ${method}` }, { status: 403 });
    }
  }

  try {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "RPC unavailable" }, { status: 502 });
  }
}
