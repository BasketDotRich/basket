import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { custodyConfigured, generateWallet } from "@/lib/custody";
import { LAMPORTS_PER_SOL, WITHDRAW_RESERVE_LAMPORTS, getAccountWallet, getSolBalance } from "@/lib/accounts";
import { solPriceUsd } from "@/lib/treasury";

/**
 * The account's own Solana wallet: deposit address and live on-chain balance.
 * The encrypted secret is never part of any response.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!custodyConfigured()) {
    return NextResponse.json(
      { error: "Wallets are not configured on this server (ENCRYPTION_KEY missing)" },
      { status: 503 }
    );
  }

  const db = getDb();
  let wallet = getAccountWallet(user.id);
  // back-fill for accounts created before wallets existed
  if (!wallet) {
    const fresh = generateWallet();
    db.prepare("UPDATE users SET wallet_address = ?, wallet_key = ? WHERE id = ?").run(
      fresh.address,
      fresh.encryptedKey,
      user.id
    );
    wallet = { address: fresh.address, encryptedKey: fresh.encryptedKey };
  }

  let lamports = 0;
  let balanceError = false;
  try {
    lamports = await getSolBalance(wallet.address);
  } catch {
    balanceError = true;
  }
  const solUsd = await solPriceUsd();
  const sol = lamports / LAMPORTS_PER_SOL;

  return NextResponse.json({
    address: wallet.address,
    sol,
    usd: solUsd != null ? sol * solUsd : null,
    solPrice: solUsd,
    withdrawableSol: Math.max(0, (lamports - WITHDRAW_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL),
    reserveSol: WITHDRAW_RESERVE_LAMPORTS / LAMPORTS_PER_SOL,
    balanceError,
  });
}
