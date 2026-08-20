"use client";

import { useCallback, useEffect, useState } from "react";
import { cls, fmtUsd } from "@/lib/format";

type AccountInfo = {
  address: string;
  sol: number;
  usd: number | null;
  solPrice: number | null;
  withdrawableSol: number;
  reserveSol: number;
  balanceError: boolean;
};

export function AccountWallet() {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [copied, setCopied] = useState(false);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; sig?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/account", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error ?? "Could not load your wallet");
        return;
      }
      setInfo(d);
      setErr(null);
    } catch {
      setErr("Could not reach the server");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 45_000);
    return () => clearInterval(t);
  }, [load]);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/wallet/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: dest.trim(), amountSol: Number(amount) }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: d.error ?? "Withdrawal failed" });
        return;
      }
      setMsg({ kind: "ok", text: `Sent ${amount} SOL`, sig: d.signature });
      setAmount("");
      setDest("");
      load();
    } catch {
      setMsg({ kind: "err", text: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <div className="card p-5">
        <p className="text-[13px] text-warn">⚠ {err}</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="card p-5">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-3 h-9 w-full" />
        <div className="skeleton mt-2 h-9 w-full" />
      </div>
    );
  }

  const amountNum = Number(amount);
  const canSend =
    dest.trim().length >= 32 && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= info.withdrawableSol;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-hairline px-5 py-4">
        <div className="th">Account wallet balance</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="num text-3xl font-semibold">{info.sol.toFixed(4)}</span>
          <span className="text-sm text-ink3">SOL</span>
          {info.usd != null && (
            <span className="num ml-2 text-sm text-ink3">≈ {fmtUsd(info.usd)}</span>
          )}
        </div>
        {info.balanceError && (
          <p className="mt-1 text-[11px] text-warn">Balance feed hiccuped — retrying automatically.</p>
        )}
      </div>

      <div className="flex border-b border-hairline text-[13px] font-medium">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setMsg(null);
            }}
            className={cls(
              "flex-1 py-2.5 capitalize transition",
              tab === t ? "bg-card2 text-ink" : "text-ink3 hover:text-ink2"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "deposit" ? (
        <div className="p-5">
          <p className="text-[13px] leading-relaxed text-ink2">
            Send SOL to this address to fund your account. It arrives in seconds and shows above.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-hairline bg-card2 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
              {info.address}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(info.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="shrink-0 rounded-md border border-hairline px-2.5 py-1.5 text-[11px] text-ink2 hover:border-brand hover:text-ink"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink3">
            <span>Solana mainnet · SOL and SPL tokens only</span>
            <a
              href={`https://solscan.io/account/${info.address}`}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              View on Solscan ↗
            </a>
          </div>
          <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[11.5px] leading-relaxed text-ink2">
            Only send Solana-network assets. Anything sent from another chain is unrecoverable.
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <div>
            <label htmlFor="aw-dest" className="th">Destination address</label>
            <input
              id="aw-dest"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="Solana address"
              className="mt-1.5 w-full rounded-lg border border-hairline bg-card2 px-3 py-2.5 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-ink3 focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="aw-amount" className="th">Amount (SOL)</label>
            <div className="relative mt-1.5">
              <input
                id="aw-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="num w-full rounded-lg border border-hairline bg-card2 py-2.5 pl-3 pr-24 text-lg outline-none focus:border-brand"
              />
              <button
                onClick={() => setAmount(String(Math.floor(info.withdrawableSol * 10000) / 10000))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-hairline px-2 py-1 text-[11px] text-ink2 hover:text-ink"
              >
                Max
              </button>
            </div>
            <p className="num mt-1 text-[11px] text-ink3">
              Available {info.withdrawableSol.toFixed(4)} SOL ·{" "}
              {info.reserveSol} SOL stays for network fees
            </p>
          </div>
          <button
            onClick={send}
            disabled={!canSend || busy}
            className="btn-brand w-full rounded-lg py-2.5 text-sm font-semibold"
          >
            {busy ? "Sending…" : "Withdraw SOL"}
          </button>
          <p className="text-[11px] leading-relaxed text-ink3">
            Withdrawals are on-chain and irreversible. Double-check the address.
          </p>
        </div>
      )}

      {msg && (
        <div
          role="status"
          aria-live="polite"
          className={cls(
            "mx-5 mb-5 rounded-lg px-3 py-2 text-[12.5px]",
            msg.kind === "ok" ? "bg-good/10 text-good" : "bg-bad/10 text-bad"
          )}
        >
          {msg.text}
          {msg.sig && (
            <>
              {" "}
              <a
                href={`https://solscan.io/tx/${msg.sig}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                view ↗
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
