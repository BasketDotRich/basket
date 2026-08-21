"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { cls, fmtQty, fmtUsd } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";

type Holding = {
  mint: string;
  symbol: string;
  name: string | null;
  /** which basket bought this leg, so holdings read as index positions */
  basketId?: number | null;
  basketName?: string | null;
  icon: string | null;
  amount: number;
  price: number | null;
  valueUsd: number;
};

type Data = {
  address: string;
  sol: number;
  solUsd: number;
  tokens: Holding[];
  totalUsd: number;
};

/**
 * On-chain token holdings of the account wallet, grouped by the basket that
 * bought them.
 *
 * Deliberately READ-ONLY. A basket is an index — you exit the whole position
 * from the basket page, not one leg at a time. Selling a single token here
 * would leave the remaining legs as an unbalanced version of an index nobody
 * chose, and it silently desyncs the basket ledger from the wallet.
 */
export function WalletHoldings() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; sig?: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/wallet/holdings", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn't load holdings");
        setData(d.holdings);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => clearInterval(t);
  }, [load]);


  if (err) {
    return (
      <div className="card p-5">
        <p className="text-[13px] text-warn">⚠ {err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card p-5">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton mt-3 h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-hairline px-5 py-4">
        <span className="th">On-chain holdings</span>
        <span className="num text-sm font-semibold">{fmtUsd(data.totalUsd)}</span>
      </div>

      {data.tokens.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-ink3">
          No tokens yet — buy a basket on-chain and the tokens land here, in your own wallet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="th py-2 pl-5 font-medium">Token</th>
                <th className="th py-2 text-right font-medium">Amount</th>
                <th className="th py-2 text-right font-medium">Value</th>
                <th className="th py-2 pr-5 text-right font-medium">Basket</th>
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((t) => (
                <tr key={t.mint} className="border-b border-hairline last:border-0">
                  <td className="py-2.5 pl-5">
                    <span className="flex items-center gap-2">
                      <TokenIcon src={t.icon} symbol={t.symbol} size={22} />
                      <span className="font-medium">{t.symbol}</span>
                    </span>
                  </td>
                  <td className="num py-2.5 text-right text-ink2">{fmtQty(t.amount)}</td>
                  <td className="num py-2.5 text-right">
                    {t.price != null ? fmtUsd(t.valueUsd) : <span className="text-ink3">unpriced</span>}
                  </td>
                  <td className="py-2.5 pr-5 text-right">
                    {t.basketName ? (
                      <Link href={`/baskets/${t.basketId}`} className="text-[11.5px] text-brand hover:underline">
                        {t.basketName}
                      </Link>
                    ) : (
                      <span className="text-[11.5px] text-ink3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && (
        <div
          role="status"
          aria-live="polite"
          className={cls(
            "mx-5 mb-4 mt-2 rounded-lg px-3 py-2 text-[12.5px]",
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
