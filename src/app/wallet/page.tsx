"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cls, fmtUsd, timeAgo } from "@/lib/format";
import { AccountWallet } from "@/components/AccountWallet";

type Tx = {
  id: number;
  type: "deposit" | "withdraw" | "invest" | "redeem";
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
};

export default function WalletPage() {
  const router = useRouter();
  const [cash, setCash] = useState<number | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [unauthorized, setUnauthorized] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (res.status === 401) {
      setUnauthorized(true);
      return;
    }
    const d = await res.json();
    setCash(d.cash);
    setTxs(d.transactions ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/wallet/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: d.error ?? "Something went wrong" });
        return;
      }
      setMsg({
        kind: "ok",
        text: mode === "deposit" ? `Added ${fmtUsd(Number(amount))} to your balance` : `Withdrew ${fmtUsd(Number(amount))}`,
      });
      setAmount("");
      await load();
      router.refresh(); // update the cash chip in the nav
    } catch {
      setMsg({ kind: "err", text: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  if (unauthorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mt-3 text-xl font-semibold">Sign in to see your wallet</h1>
        <Link href="/login" className="btn-brand mt-5 inline-block rounded-xl px-6 py-2.5 text-sm font-semibold">
          Sign in
        </Link>
      </div>
    );
  }

  const amountNum = Number(amount);
  const valid =
    Number.isFinite(amountNum) &&
    amountNum >= 1 &&
    (mode === "deposit" || (cash != null && amountNum <= cash + 1e-9));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="display text-[34px]">Wallet</h1>
      <p className="mt-1 text-sm text-ink3">
        Your account&apos;s own Solana wallet. Deposit SOL to fund it, withdraw any time — on-chain basket buys from this balance are rolling out.
      </p>

      <div className="mt-6">
        <AccountWallet />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Practice balance</h2>
      <p className="mb-3 text-[13px] text-ink3">
        A separate sandbox for testing basket strategies without spending SOL.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <div className="text-xs uppercase tracking-widest text-ink3">Available cash</div>
          <div className="mt-2 text-4xl font-semibold tabular-nums">
            {cash == null ? "…" : fmtUsd(cash)}
          </div>
          <p className="mt-2 text-xs text-ink3">
            Sandbox dollars for testing basket mechanics. Separate from your SOL wallet above.
          </p>
        </div>

        <div className="card p-6">
          <div className="flex rounded-xl border border-hairline bg-card2 p-1 text-sm font-medium">
            {(["deposit", "withdraw"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setMsg(null);
                }}
                className={cls(
                  "flex-1 rounded-lg py-1.5 capitalize transition",
                  mode === m ? "bg-card text-ink shadow" : "text-ink3 hover:text-ink2"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="relative mt-3">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink3">$</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Amount in USD"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full rounded-xl border border-hairline bg-card2 py-2.5 pl-8 pr-4 text-lg tabular-nums outline-none focus:border-brand"
            />
          </div>
          <div className="mt-2 flex gap-2">
            {[1000, 5000, 10000].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className="rounded-full border border-hairline px-3 py-1 text-xs text-ink2 hover:border-brand hover:text-ink"
              >
                ${v.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="btn-brand mt-3 w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            {busy ? "Processing…" : mode === "deposit" ? "Add funds" : "Withdraw"}
          </button>
          {msg && (
            <div
              className={cls(
                "mt-3 rounded-lg px-3 py-2 text-sm",
                msg.kind === "ok" ? "bg-good/10 text-good" : "bg-bad/10 text-bad"
              )}
            >
              {msg.text}
            </div>
          )}
        </div>
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
                  <span className={cls("flex h-7 w-7 items-center justify-center rounded-md bg-card2 text-sm font-semibold", TX_SIGN[tx.type].cls)} aria-hidden>
                    {TX_SIGN[tx.type].glyph}
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
                    <div className="truncate text-xs text-ink3">{tx.detail}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className={cls("text-sm font-semibold tabular-nums", inflow ? "text-good" : "text-ink")}>
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
