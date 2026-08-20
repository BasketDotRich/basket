import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import {
  basketChange24h,
  getPortfolio,
  getSnapshots,
  recordSnapshot,
} from "@/lib/portfolio";
import { fmtPct, fmtQty, fmtUsd } from "@/lib/format";
import { StatTile } from "@/components/StatTile";
import { Onboarding, type OnboardingState } from "@/components/Onboarding";
import { getDb } from "@/lib/db";
import { RuleChip } from "@/components/RuleChip";
import { Delta } from "@/components/Delta";
import { TokenIcon } from "@/components/TokenIcon";
import { LineChart } from "@/components/LineChart";
import { Donut } from "@/components/Donut";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  await recordSnapshot(user.id);

  const db = getDb();
  const onboarding: OnboardingState = {
    invested:
      !!db.prepare("SELECT 1 FROM holdings WHERE user_id = ? AND qty > 0 LIMIT 1").get(user.id) ||
      !!db.prepare("SELECT 1 FROM trader_holdings WHERE user_id = ? AND units > 0 LIMIT 1").get(user.id),
    armedRule: !!db.prepare("SELECT 1 FROM position_rules WHERE user_id = ? LIMIT 1").get(user.id),
    createdBasket: !!db.prepare("SELECT 1 FROM baskets WHERE owner_id = ? LIMIT 1").get(user.id),
  };
  const { cash, positions, totalValue, totalCost } = await getPortfolio(user.id);
  const snapshots = getSnapshots(user.id);

  const invested = totalValue - cash;
  const pnl = invested - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : null;

  let change24h: number | null = null;
  if (invested > 0) {
    let acc = 0;
    for (const p of positions) {
      const ch = await basketChange24h(p.basket);
      if (ch != null) acc += (p.value / invested) * ch;
    }
    change24h = acc;
  }

  const donutSlices = [
    ...positions.map((p) => ({ label: p.basket.name, value: p.value })),
    { label: "Cash", value: cash },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[34px]">Portfolio</h1>
          <p className="mt-1 text-sm text-ink3">Hey @{user.username} — here&apos;s where you stand.</p>
        </div>
        <Link href="/baskets" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          Explore baskets
        </Link>
      </div>

      <Onboarding state={onboarding} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Portfolio value" value={fmtUsd(totalValue)} sub={<Delta value={change24h} suffix="24h" />} />
        <StatTile label="Invested" value={fmtUsd(invested)} sub={<span className="text-ink3">across {positions.length} basket{positions.length === 1 ? "" : "s"}</span>} />
        <StatTile
          label="Unrealized PnL"
          value={`${pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(pnl))}`}
          sub={<Delta value={pnlPct} suffix="vs cost" />}
        />
        <StatTile label="Cash" value={fmtUsd(cash)} sub={<Link href="/wallet" className="text-brand hover:underline">Manage wallet →</Link>} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="card p-5 lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-ink2">Portfolio value over time</h2>
          {snapshots.length >= 2 ? (
            <LineChart
              points={snapshots.map((s) => [s.ts, s.value])}
              format="usd-compact"
              height={240}
            />
          ) : (
            <div className="flex h-[240px] items-center justify-center text-center text-sm text-ink3">
              Your value chart builds as you trade — make an investment and check back.
            </div>
          )}
        </div>
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink2">Allocation</h2>
          <Donut slices={donutSlices} format="usd-compact" />
        </div>
      </div>

      <h2 className="mb-4 mt-10 text-lg font-semibold">Your positions</h2>
      {positions.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink2">No positions yet — you have {fmtUsd(cash)} available to deploy.</p>
          <Link href="/baskets" className="btn-brand mt-4 inline-block rounded-xl px-5 py-2.5 text-sm">
            Find a basket
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {positions.map((p) => {
            const posPnl = p.value - p.cost;
            const posPct = p.cost > 0 ? (posPnl / p.cost) * 100 : null;
            return (
              <div key={`${p.kind}-${p.basket.id}`} className="card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-card2 text-xs font-semibold text-ink2">{p.basket.name.slice(0, 2).toUpperCase()}</span>
                  <Link href={`/baskets/${p.basket.id}`} className="font-semibold hover:text-brand">
                    {p.basket.name}
                  </Link>
                  <span className="chip">{p.kind === "trader" ? "TRADER BASKET" : "COIN BASKET"}</span>
                  {p.rule && <RuleChip basketId={p.basket.id} rule={p.rule} />}
                  <div className="ml-auto flex items-center gap-4 text-sm">
                    <span className="num font-semibold">{fmtUsd(p.value)}</span>
                    <span className="num text-ink3">
                      {posPnl >= 0 ? "+" : "−"}
                      {fmtUsd(Math.abs(posPnl))}
                    </span>
                    <Delta value={posPct} />
                  </div>
                </div>
                {p.kind === "coin" && p.tokens && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="text-left">
                          <th className="th pb-2 font-medium">Token</th>
                          <th className="th pb-2 text-right font-medium">Amount</th>
                          <th className="th pb-2 text-right font-medium">Value</th>
                          <th className="th pb-2 text-right font-medium">24h</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.tokens.map((t) => (
                          <tr key={t.mint} className="border-t border-hairline">
                            <td className="py-2">
                              <span className="flex items-center gap-2">
                                <TokenIcon src={t.icon} symbol={t.symbol} size={22} />
                                <span className="font-medium">{t.symbol}</span>
                              </span>
                            </td>
                            <td className="num py-2 text-right text-ink2">{fmtQty(t.qty)}</td>
                            <td className="num py-2 text-right">
                              {fmtUsd(t.value)}
                              {t.unpriced && (
                                <span className="chip ml-1.5" style={{ color: "var(--warn)", borderColor: "rgba(240,180,41,0.4)" }}>
                                  UNPRICED
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              <Delta value={t.change24h} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {p.kind === "trader" && (
                  <p className="mt-3 text-sm text-ink3">
                    {fmtQty(p.units ?? 0)} units @ NAV {(p.nav ?? 0).toFixed(2)} ·{" "}
                    <span className="text-ink2">on-chain tracked NAV</span> ·{" "}
                    {fmtPct(posPct)} since entry
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
