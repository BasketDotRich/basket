import Link from "next/link";
import { getDb } from "@/lib/db";
import {
  CREATION_FEE_SOL,
  PERFORMANCE_FEE_BPS,
  getLedger,
  getTreasuryStats,
  solPriceUsd,
} from "@/lib/treasury";
import { fmtUsd, timeAgo } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  performance_fee: { label: "PERF FEE", cls: "text-good" },
  creation_fee: { label: "CREATION", cls: "text-brand" },
  treasury_pnl: { label: "→ BURN", cls: "text-warn" },
  deploy: { label: "DEPLOY", cls: "text-ink2" },
  burn: { label: "BURNED", cls: "text-bad" },
};

export default async function TreasuryPage() {
  const stats = await getTreasuryStats();
  const ledger = getLedger(40);
  const sol = await solPriceUsd();
  const db = getDb();

  const snaps = db
    .prepare(
      `SELECT ts, kind, amount_usd FROM treasury_ledger
       WHERE kind IN ('performance_fee','creation_fee') ORDER BY ts ASC LIMIT 2000`
    )
    .all() as { ts: number; amount_usd: number }[];
  let running = 0;
  const curve: [number, number][] = snaps.map((r) => {
    running += r.amount_usd;
    return [r.ts, running];
  });

  const tiles = [
    { label: "Total fees accrued", value: fmtUsd(stats.totalInflow), sub: `${stats.basketsCreated} baskets created` },
    { label: "Performance fees", value: fmtUsd(stats.performanceFees), sub: `${PERFORMANCE_FEE_BPS / 100}% of realised profit` },
    { label: "Creation fees", value: fmtUsd(stats.creationFees), sub: `${stats.creationFeesSol.toFixed(1)} SOL collected` },
    { label: "Deployed in baskets", value: fmtUsd(stats.deployedValue), sub: `${fmtUsd(stats.treasuryCash)} idle` },
    { label: "Queued for burn", value: fmtUsd(stats.pendingBurn), sub: "treasury profit awaiting buyback" },
    { label: "Burned to date", value: fmtUsd(stats.burned), sub: "executed on-chain" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-[34px]">Treasury &amp; burn</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink2">
            Every fee the protocol earns is itemised here. Fees fund the treasury, the treasury
            deploys into baskets, and the profit from those positions buys back and burns the
            platform token.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/tokenomics" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
            $BASKET tokenomics
          </Link>
          <Link href="/baskets/new" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
            Create a basket
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline lg:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-card px-4 py-3.5">
            <div className="th">{t.label}</div>
            <div className="num mt-1 text-[19px] font-semibold">{t.value}</div>
            <div className="mt-0.5 text-[11px] text-ink3">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink2">Cumulative fee accrual</h2>
          {curve.length >= 2 ? (
            <LineChart points={curve} format="usd-compact" height={240} color="var(--s3)" />
          ) : (
            <div className="flex h-[240px] items-center justify-center text-center text-[13px] text-ink3">
              No fees yet — the curve starts with the first profitable redeem or basket creation.
            </div>
          )}
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink2">How it works</h2>
          <ol className="space-y-3 text-[13px] leading-relaxed text-ink2">
            <li>
              <span className="chip">1</span>{" "}
              <strong className="text-ink">{PERFORMANCE_FEE_BPS / 100}% of realised profit</strong> on
              every redeem goes to the treasury. Profit only — never on your principal, never on a
              losing trade.
            </li>
            <li>
              <span className="chip">2</span>{" "}
              <strong className="text-ink">{CREATION_FEE_SOL} SOL per basket</strong>
              {sol ? ` (≈${fmtUsd(CREATION_FEE_SOL * sol)} today)` : ""} to create one. 100% routes
              to buyback &amp; burn.
            </li>
            <li>
              <span className="chip">3</span> The treasury <strong className="text-ink">deploys
              that capital into the most subscribed baskets</strong> rather than sitting idle.
            </li>
            <li>
              <span className="chip">4</span> Profit the treasury realises is{" "}
              <strong className="text-ink">queued for buyback &amp; burn</strong> of the platform
              token — permanently reducing supply.
            </li>
          </ol>
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink3">
            Pre-launch status: the platform token isn&apos;t live yet, so this is an accrual ledger —
            it records exactly what the burn engine will execute against at launch. Nothing below is
            shown as an on-chain burn that hasn&apos;t happened.
          </p>
        </div>
      </div>

      <h2 className="mb-2 mt-8 text-lg font-semibold tracking-tight">Ledger</h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left">
              <th className="th py-2 pl-3 font-medium">Type</th>
              <th className="th py-2 font-medium">Detail</th>
              <th className="th py-2 text-right font-medium">Amount</th>
              <th className="th py-2 pr-3 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-ink3">
                  No treasury activity yet.
                </td>
              </tr>
            )}
            {ledger.map((r) => {
              const k = KIND_LABEL[r.kind] ?? { label: r.kind.toUpperCase(), cls: "text-ink2" };
              return (
                <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-card2/60">
                  <td className="py-2 pl-3">
                    <span className={`chip ${k.cls}`}>{k.label}</span>
                  </td>
                  <td className="py-2 text-ink2">{r.detail}</td>
                  <td className="num py-2 text-right">
                    {r.amount_usd === 0 ? (
                      <span className="text-ink3">—</span>
                    ) : (
                      <span className={r.kind === "burn" ? "text-bad" : "text-good"}>
                        {r.kind === "burn" ? "−" : "+"}
                        {fmtUsd(Math.abs(r.amount_usd))}
                      </span>
                    )}
                    {r.amount_sol != null && (
                      <span className="ml-1 text-[11px] text-ink3">({r.amount_sol} SOL)</span>
                    )}
                  </td>
                  <td className="num py-2 pr-3 text-right text-xs text-ink3">{timeAgo(r.ts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
