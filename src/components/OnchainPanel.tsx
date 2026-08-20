"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cls } from "@/lib/format";

type BuyResult = {
  signatures: string[];
  legs: { symbol: string; solIn: number }[];
};

/**
 * Real on-chain basket buys from the account wallet. Separate from the
 * practice-balance InvestPanel on purpose: this one moves real SOL.
 */
export function OnchainPanel({ basketId, signedIn }: { basketId: number; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);

  const loadBalance = useCallback(() => {
    fetch("/api/wallet/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setSol(d.sol ?? 0);
          setAddress(d.address ?? null);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (signedIn && open) loadBalance();
  }, [signedIn, open, loadBalance]);

  if (!signedIn) return null;

  async function buy() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/baskets/${basketId}/buy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountSol: Number(amount) }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error ?? "The buy failed");
        return;
      }
      setResult(d);
      setAmount("");
      setConfirming(false);
      loadBalance();
    } catch {
      setErr("Network error — check your wallet on Solscan before retrying");
    } finally {
      setBusy(false);
    }
  }

  const amountNum = Number(amount);
  const maxSol = sol != null ? Math.max(0, sol - 0.005) : 0;
  const valid = Number.isFinite(amountNum) && amountNum >= 0.01 && amountNum <= maxSol;

  return (
    <div className="card p-5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
          Buy on-chain
        </span>
        <span className="text-ink3">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-[11.5px] leading-relaxed text-ink3">
            Executes real Jupiter swaps from your account wallet — the tokens land in your wallet,
            weighted like this basket. Irreversible once sent.
          </p>
          <div className="flex items-center justify-between text-xs text-ink3">
            <span>Wallet SOL</span>
            <span className="num">{sol != null ? `${sol.toFixed(4)} SOL` : "…"}</span>
          </div>

          {sol != null && sol < 0.015 ? (
            <div className="rounded-lg border border-hairline bg-card2 p-3 text-xs leading-relaxed text-ink2">
              Deposit SOL to your account wallet first —{" "}
              <Link href="/wallet" className="text-brand hover:underline">
                your deposit address is on the wallet page
              </Link>
              .
            </div>
          ) : (
            <>
              <div className="relative">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Amount to buy in SOL"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                    setConfirming(false);
                  }}
                  className="num w-full rounded-xl border border-hairline bg-card2 py-2.5 pl-4 pr-16 text-lg outline-none focus:border-brand"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink3">SOL</span>
              </div>
              <div className="flex gap-2">
                {[0.05, 0.1, 0.5].map((v) => (
                  <button
                    key={v}
                    onClick={() => { setAmount(String(v)); setConfirming(false); }}
                    className="rounded-full border border-hairline px-3 py-1 text-xs text-ink2 hover:border-brand hover:text-ink"
                  >
                    {v} SOL
                  </button>
                ))}
                <button
                  onClick={() => { setAmount(maxSol > 0 ? maxSol.toFixed(4) : ""); setConfirming(false); }}
                  className="rounded-full border border-hairline px-3 py-1 text-xs text-ink2 hover:border-brand hover:text-ink"
                >
                  Max
                </button>
              </div>
              {!confirming ? (
                <button
                  disabled={!valid || busy}
                  onClick={() => setConfirming(true)}
                  className="btn-brand w-full rounded-xl py-2.5 text-sm"
                >
                  Buy {valid ? `${amountNum} SOL` : ""} on-chain
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-center text-xs text-warn">
                    Real swap, real SOL, irreversible. Confirm?
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={buy}
                      className="btn-brand flex-1 rounded-xl py-2.5 text-sm"
                    >
                      {busy ? "Swapping…" : "Confirm buy"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                      className="btn-ghost flex-1 rounded-xl py-2.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {err && (
            <p role="status" aria-live="polite" className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">
              {err}
            </p>
          )}
          {result && (
            <div role="status" aria-live="polite" className="rounded-lg bg-good/10 p-3 text-xs text-good">
              <p className="font-medium">Executed {result.legs.length} swaps</p>
              <ul className="mt-1 space-y-0.5">
                {result.legs.map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {l.symbol} · <span className="num">{l.solIn.toFixed(4)} SOL</span>
                    </span>
                    {result.signatures[i] && (
                      <a
                        href={`https://solscan.io/tx/${result.signatures[i]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        view ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {address && (
            <p className="text-[10.5px] text-ink3">
              Holdings live in your wallet{" "}
              <a
                href={`https://solscan.io/account/${address}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-ink2"
              >
                {address.slice(0, 4)}…{address.slice(-4)} ↗
              </a>{" "}
              — sell any time from <Link href="/wallet" className="text-brand hover:underline">the wallet page</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
