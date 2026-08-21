"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cls, fmtUsd, timeAgo } from "@/lib/format";
import { AccountWallet } from "@/components/AccountWallet";
import { TxDetail } from "@/components/TxDetail";
import { WalletHoldings } from "@/components/WalletHoldings";
import { TelegramLink } from "@/components/TelegramLink";

type Tx = {
  id: number;
  type: "deposit" | "withdraw" | "invest" | "redeem" | "trade" | "fee";
  basket_id: number | null;
  amount: number;
  detail: string;
  created_at: number;
  basket_name: string | null;
  basket_emoji: string | null;
};

const TX_SIGN: Record<Tx["type"], { glyph: string; cls: string }> = {
  deposit: { glyph: "+", cls: "text-good" },
  withdraw: { glyph: "−", cls: "text-ink2" },
  invest: { glyph: "→", cls: "text-brand" },
  redeem: { glyph: "←", cls: "text-good" },
  trade: { glyph: "⇄", cls: "text-brand" },
  fee: { glyph: "🔥", cls: "text-warn" },
};

export default function WalletPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [unauthorized, setUnauthorized] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (res.status === 401) {
      setUnauthorized(true);
      return;
    }
    const d = await res.json();
    setTxs(d.transactions ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (unauthorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mt-3 text-xl font-semibold">Sign in to see your wallet</h1>
        <Link href="/login" className="btn-brand mt-5 inline-block rounded-xl px-6 py-2.5 text-sm">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="display text-[34px]">Wallet</h1>
      <p className="mt-1 text-sm text-ink3">
        Your account&apos;s own Solana wallet. Deposit SOL, buy baskets on-chain, sell back to SOL,
        withdraw any time. Every number here is real.
      </p>

      <div className="mt-6">
        <AccountWallet />
        <div className="mt-4"><WalletHoldings /></div>
        <div className="mt-4"><TelegramLink /></div>
      </div>

      <h2 className="mb-4 mt-10 text-lg font-semibold">Activity</h2>
      <div className="card overflow-hidden">
        {txs.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink3">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {txs.map((tx) => {
              const inflow = tx.type === "deposit" || tx.type === "redeem";
              return (
                <li key={tx.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={cls("flex h-7 w-7 items-center justify-center rounded-md bg-card2 text-sm font-semibold", (TX_SIGN[tx.type] ?? TX_SIGN.trade).cls)} aria-hidden>
                    {(TX_SIGN[tx.type] ?? TX_SIGN.trade).glyph}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium capitalize">
                      {tx.type}
                      {tx.basket_name ? (
                        <span className="font-normal text-ink2">
                          {" "}· {tx.basket_name}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-ink3"><TxDetail detail={tx.detail} /></div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className={cls("num text-sm font-semibold", inflow ? "text-good" : "text-ink")}>
                      {inflow ? "+" : "−"}
                      {fmtUsd(Math.abs(tx.amount))}
                    </div>
                    <div className="text-xs text-ink3">{timeAgo(tx.created_at)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
