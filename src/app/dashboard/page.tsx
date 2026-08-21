import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import {
  basketChange24h,
  getPortfolio,
  getSnapshots,
  recordSnapshot,
} from "@/lib/portfolio";
import { getAccountWallet, getSolBalance } from "@/lib/accounts";
import { solPriceUsd } from "@/lib/treasury";
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
  const { positions, totalValue, totalCost } = await getPortfolio(user.id);
  const snapshots = getSnapshots(user.id);

  // Standing squad allocations. A commitment with nothing deployed yet is
  // still a commitment — omitting it is why a funded account could read
  // "No positions yet", which led to funding it again.
  const solPx = (await solPriceUsd()) ?? 0;
  const allocations = (
    db
      .prepare(
        `SELECT th.basket_id, th.allocated_lamports, b.name
         FROM trader_holdings th JOIN baskets b ON b.id = th.basket_id
         WHERE th.user_id = ? AND th.allocated_lamports > 0`
      )
      .all(user.id) as { basket_id: number; allocated_lamports: number; name: string }[]
  ).map((r) => {
    const deployedUsd = (
      db
        .prepare("SELECT COALESCE(SUM(cost),0) AS c FROM holdings WHERE user_id = ? AND basket_id = ?")
        .get(user.id, r.basket_id) as { c: number }
    ).c;
    const deployedSol = solPx > 0 ? deployedUsd / solPx : 0;
    const pledgedSol = r.allocated_lamports / 1e9;
    return {
      basketId: r.basket_id,
      name: r.name,
      pledgedSol,
      deployedSol,
      idleSol: Math.max(0, pledgedSol - deployedSol),
    };
  });

  // real wallet SOL, straight from the chain
  let walletSol: number | null = null;
  let walletUsd: number | null = null;
  try {
    const w = getAccountWallet(user.id);
    if (w) {
      const [lamports, solPrice] = await Promise.all([getSolBalance(w.address), solPriceUsd()]);
      walletSol = lamports / 1_000_000_000;
      walletUsd = solPrice != null ? walletSol * solPrice : null;
    }
  } catch {
    // RPC hiccup — the tile shows a dash
  }

  const invested = totalValue;
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
    ...(walletUsd != null && walletUsd > 0 ? [{ label: "Wallet SOL", value: walletUsd }] : []),
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
        <StatTile
          label="Wallet SOL"
          value={walletSol != null ? `${walletSol.toFixed(3)} SOL` : "—"}
          sub={
            <Link href="/wallet" className="text-brand hover:underline">
              {walletUsd != null ? `≈ ${fmtUsd(walletUsd)} · ` : ""}Manage wallet →
            </Link>
          }
        />
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

      {allocations.length > 0 && (
        <>
          <h2 className="mb-1 mt-10 text-lg font-semibold">Following</h2>
          <p className="mb-4 text-[13px] text-ink3">
            Standing allocations to KOL squads. These follow the squad in and out automatically.
          </p>
          <div className="space-y-3">
            {allocations.map((a) => (
              <Link key={a.basketId} href={`/baskets/${a.basketId}`} className="card lift block p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{a.name}</span>
                  <span className="num text-[15px]">
                    {a.pledgedSol.toFixed(3)} <span className="text-[12px] text-ink3">SOL allocated</span>
                  </span>
                </div>
                <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-card3">
                  <span
                    className="block h-full bg-brand"
                    style={{ width: `${Math.min(100, (a.deployedSol / Math.max(a.pledgedSol, 1e-9)) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11.5px] text-ink3">
                  <span><span className="num text-brand">{a.deployedSol.toFixed(3)}</span> deployed</span>
                  <span><span className="num">{a.idleSol.toFixed(3)}</span> waiting as SOL</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-4 mt-10 text-lg font-semibold">Your positions</h2>
      {positions.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink2">
            {allocations.length > 0
              ? "No coin-basket positions — your squad allocations are shown above."
              : walletSol != null && walletSol > 0.015
                ? `No positions yet — you have ${walletSol.toFixed(3)} SOL ready to deploy.`
                : "No positions yet — deposit SOL to your wallet and buy your first basket."}
          </p>
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
