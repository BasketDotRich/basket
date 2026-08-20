"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cls, fmtUsd } from "@/lib/format";

export type PanelRule = {
  tp_pct: number | null;
  sl_pct: number | null;
  close_at: number | null;
} | null;

/**
 * REAL on-chain investing. Invest swaps the account wallet's SOL into every
 * basket leg; redeem swaps the position back to SOL. No virtual balances.
 */
export function InvestPanel({
  basketId,
  signedIn,
  myValue,
  rule,
  onDone,
}: {
  basketId: number;
  signedIn: boolean;
  myValue: number;
  rule?: PanelRule;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"invest" | "redeem">("invest");
  const [amount, setAmount] = useState("");
  const [fraction, setFraction] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; sigs?: string[] } | null>(null);
  const [writeOff, setWriteOff] = useState<string[] | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [tpPct, setTpPct] = useState<number | null>(null);
  const [slPct, setSlPct] = useState<number | null>(null);
  const [closeDays, setCloseDays] = useState<number | null>(null);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);

  const loadBalance = useCallback(() => {
    fetch("/api/wallet/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setSol(d.sol ?? 0);
          setSolPrice(d.solPrice ?? null);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (signedIn) loadBalance();
  }, [signedIn, loadBalance]);

  // Show the rules that are actually armed, so a top-up (or an edit) starts
  // from reality instead of a blank slate that could read as "no rules".
  useEffect(() => {
    if (rulesDirty) return;
    setTpPct(rule?.tp_pct ?? null);
    setSlPct(rule?.sl_pct ?? null);
    setCloseDays(
      rule?.close_at != null
        ? Math.max(1, Math.round((rule.close_at - Date.now()) / 86_400_000))
        : null
    );
  }, [rule, rulesDirty]);

  if (!signedIn) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-ink2">Create a free account to take a position in this basket.</p>
        <Link href="/register" className="btn-brand mt-4 inline-block rounded-xl px-6 py-2.5 text-sm">
          Open an account
        </Link>
      </div>
    );
  }

  async function act(allowUnpriced = false) {
    setBusy(true);
    setMsg(null);
    try {
      const url = `/api/baskets/${basketId}/${tab}`;
      const body =
        tab === "invest"
          ? rulesDirty
            ? { amountSol: Number(amount), tpPct, slPct, closeDays }
            : { amountSol: Number(amount) }
          : { fraction, allowUnpriced };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409 && data.canWriteOff) {
        setWriteOff(data.unpriced ?? []);
        setMsg(null);
        return;
      }
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Something went wrong" });
        return;
      }
      setWriteOff(null);
      setConfirming(false);
      setMsg({
        kind: "ok",
        text:
          tab === "invest"
            ? `Bought on-chain with ${amount} SOL`
            : `Sold ${(fraction * 100).toFixed(0)}% back to SOL — ${fmtUsd(data.proceeds)}`,
        sigs: data.signatures,
      });
      setAmount("");
      loadBalance();
      router.refresh();
      onDone?.();
    } catch {
      setMsg({ kind: "err", text: "Network error — check your wallet on Solscan before retrying" });
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/baskets/${basketId}/rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tpPct, slPct, closeDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Could not save the rules" });
        return;
      }
      setRulesDirty(false);
      setMsg({
        kind: "ok",
        text: tpPct || slPct || closeDays ? "Exit rules updated" : "Exit rules cleared",
      });
      router.refresh();
      onDone?.();
    } catch {
      setMsg({ kind: "err", text: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  const amountNum = Number(amount);
  const maxSol = sol != null ? Math.max(0, sol - 0.005) : 0;
  const investValid = Number.isFinite(amountNum) && amountNum >= 0.01 && amountNum <= maxSol;
  const needsDeposit = sol != null && sol < 0.015;

  return (
    <div className="card p-5">
      <div className="flex rounded-xl border border-hairline bg-card2 p-1 text-sm font-medium">
        {(["invest", "redeem"] as const).map((t) => (
          <button
            key={t}
            className={cls(
              "flex-1 rounded-lg py-1.5 capitalize transition",
              tab === t ? "bg-card text-ink shadow" : "text-ink3 hover:text-ink2"
            )}
            onClick={() => {
              setTab(t);
              setMsg(null);
              setConfirming(false);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "invest" ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-ink3">
            <span>Wallet SOL</span>
            <span className="num">
              {sol != null ? `${sol.toFixed(4)} SOL` : "…"}
              {sol != null && solPrice != null && (
                <span className="ml-1.5 text-ink3">≈ {fmtUsd(sol * solPrice)}</span>
              )}
            </span>
          </div>

          {needsDeposit ? (
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
                  aria-label="Amount to invest in SOL"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                    setConfirming(false);
                  }}
                  className="num w-full rounded-xl border border-hairline bg-card2 py-2.5 pl-4 pr-16 text-lg outline-none focus:border-brand"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink3">SOL</span>
              </div>
              {investValid && solPrice != null && (
                <p className="num text-right text-[11px] text-ink3">≈ {fmtUsd(amountNum * solPrice)}</p>
              )}
              <div className="flex flex-wrap gap-2">
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
            </>
          )}

          <button
            onClick={() => setAdvanced(!advanced)}
            className="flex w-full items-center justify-between text-[11px] uppercase tracking-widest text-ink3 hover:text-ink2"
          >
            <span>Exit rules {tpPct || slPct || closeDays ? "· armed" : ""}</span>
            <span>{advanced ? "−" : "+"}</span>
          </button>
          {advanced && (
            <div className="space-y-2.5 rounded-lg border border-hairline bg-card2 p-3">
              <p className="text-[11px] leading-relaxed text-ink3">
                Memecoins don&apos;t last forever — set the exit before the entry. Rules are
                checked every minute against live prices and auto-sell the whole position
                on-chain.
              </p>
              {(
                [
                  { label: "Take profit", value: tpPct, set: setTpPct, opts: [25, 50, 100, 200], fmt: (v: number) => `+${v}%` },
                  { label: "Stop loss", value: slPct, set: setSlPct, opts: [20, 35, 50, 75], fmt: (v: number) => `−${v}%` },
                  { label: "Auto-close", value: closeDays, set: setCloseDays, opts: [7, 14, 30, 90], fmt: (v: number) => `${v}d` },
                ] as const
              ).map((row) => (
                <div key={row.label} className="flex items-center gap-1.5">
                  <span className="w-20 shrink-0 text-[11px] text-ink3">{row.label}</span>
                  {row.opts.map((v) => (
                    <button
                      key={v}
                      onClick={() => { setRulesDirty(true); row.set(row.value === v ? null : v); }}
                      className={cls(
                        "num flex-1 rounded-md border px-1 py-1 text-[11px]",
                        row.value === v
                          ? "border-brand bg-brand/15 text-ink"
                          : "border-hairline text-ink2 hover:border-brand/50"
                      )}
                    >
                      {row.fmt(v)}
                    </button>
                  ))}
                </div>
              ))}
              {myValue > 0 && (
                <button
                  onClick={saveRules}
                  disabled={busy || !rulesDirty}
                  className="w-full rounded-md border border-brand/50 py-1.5 text-[11.5px] font-medium text-brand transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink3"
                >
                  {busy ? "Saving…" : "Save rules for current position"}
                </button>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-ink3">
            Real Jupiter swaps from your wallet — tokens land in your wallet, weighted like this
            basket. 10% fee on realised profit only; fees fund buyback &amp; burn.
          </p>

          {!confirming ? (
            <button
              disabled={!investValid || busy || needsDeposit}
              onClick={() => setConfirming(true)}
              className="btn-brand w-full rounded-xl py-2.5 text-sm"
            >
              {tpPct || slPct || closeDays ? "Invest with exit rules" : "Invest"}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-center text-xs text-warn">
                Real swap of {amountNum} SOL — irreversible once sent. Confirm?
              </p>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => act(false)} className="btn-brand flex-1 rounded-xl py-2.5 text-sm">
                  {busy ? "Swapping…" : "Confirm invest"}
                </button>
                <button disabled={busy} onClick={() => setConfirming(false)} className="btn-ghost flex-1 rounded-xl py-2.5 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-ink3">
            <span>Your position</span>
            <span className="num">{fmtUsd(myValue)}</span>
          </div>
          <input
            type="range"
            aria-label="Percentage of position to sell"
            min={5}
            max={100}
            step={5}
            value={Math.round(fraction * 100)}
            onChange={(e) => setFraction(Number(e.target.value) / 100)}
            className="w-full"
          />
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink3">Sell {Math.round(fraction * 100)}%</span>
            <span className="num text-ink2">≈ {fmtUsd(myValue * fraction)}</span>
          </div>
          <div className="flex gap-2">
            {[0.25, 0.5, 1].map((f) => (
              <button
                key={f}
                onClick={() => setFraction(f)}
                className={cls(
                  "flex-1 rounded-full border px-3 py-1 text-xs",
                  fraction === f ? "border-brand text-ink" : "border-hairline text-ink2 hover:text-ink"
                )}
              >
                {f === 1 ? "All" : `${f * 100}%`}
              </button>
            ))}
          </div>
          {!confirming ? (
            <button
              disabled={myValue <= 0 || busy}
              onClick={() => setConfirming(true)}
              className="w-full rounded-xl border border-hairline bg-card2 py-2.5 text-sm font-semibold text-ink hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sell to SOL
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-center text-xs text-warn">
                Real on-chain sell of {Math.round(fraction * 100)}% — irreversible. Confirm?
              </p>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => act(false)} className="btn-brand flex-1 rounded-xl py-2.5 text-sm">
                  {busy ? "Selling…" : "Confirm sell"}
                </button>
                <button disabled={busy} onClick={() => setConfirming(false)} className="btn-ghost flex-1 rounded-xl py-2.5 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {writeOff && writeOff.length > 0 && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
              <p className="font-medium text-warn">No route back to SOL for {writeOff.join(", ")}</p>
              <p className="mt-1 leading-relaxed text-ink2">
                These may have rugged or lost all liquidity. You can sell the rest and write those
                legs off — or wait, in case liquidity returns.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => act(true)}
                  disabled={busy}
                  className="flex-1 rounded-md border border-warn/50 px-2 py-1.5 font-medium text-warn hover:bg-warn/10"
                >
                  Write off &amp; sell rest
                </button>
                <button
                  onClick={() => setWriteOff(null)}
                  className="flex-1 rounded-md border border-hairline px-2 py-1.5 text-ink2 hover:text-ink"
                >
                  Wait
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div
          role="status"
          aria-live="polite"
          className={cls(
            "mt-3 rounded-lg px-3 py-2 text-sm",
            msg.kind === "ok" ? "bg-good/10 text-good" : "bg-bad/10 text-bad"
          )}
        >
          {msg.text}
          {msg.sigs && msg.sigs.length > 0 && (
            <span className="ml-1.5">
              {msg.sigs.map((s, i) => (
                <a
                  key={s}
                  href={`https://solscan.io/tx/${s}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mr-1.5 underline"
                >
                  tx{i + 1} ↗
                </a>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
