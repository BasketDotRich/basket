import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import {
  ensureWalletRefresher,
  getTraderReturn,
  getTraderSnapshots,
  snapshotTrader,
  mintSymbol,
  getUniverseMints,
} from "@/lib/wallets";
import { fmtPct, fmtUsd, timeAgo } from "@/lib/format";
import { Delta } from "@/components/Delta";
import { TokenIcon } from "@/components/TokenIcon";
import { LineChart } from "@/components/LineChart";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600_000;

type KolPeriod = { profit: number; wins: number; losses: number };

export default async function TraderPage(props: PageProps<"/traders/[id]">) {
  const { id } = await props.params;
  const traderId = Number(id);
  if (!Number.isInteger(traderId)) notFound();

  const db = getDb();
  const trader = db
    .prepare(
      "SELECT id, name, wallet, label, bio, twitter, pfp, listed, source_url, seed_stats, created_at FROM traders WHERE id = ?"
    )
    .get(traderId) as
    | {
        id: number; name: string; wallet: string; label: string; bio: string;
        twitter: string | null; pfp: string | null; listed: number;
        source_url: string | null; seed_stats: string | null; created_at: number;
      }
    | undefined;
  if (!trader) notFound();

  ensureWalletRefresher();
  await getUniverseMints(); // warm mint→symbol map for holdings labels
  const value = await snapshotTrader(trader.id, trader.wallet).catch(() => null);
  const snapshots = getTraderSnapshots(trader.id);
  const ret24h = getTraderReturn(trader.id, DAY);
  const ret7d = getTraderReturn(trader.id, 7 * DAY);
  const seed = (trader.seed_stats ? JSON.parse(trader.seed_stats) : {}) as {
    daily?: KolPeriod; weekly?: KolPeriod; monthly?: KolPeriod; asOf?: string;
  };

  const events = db
    .prepare(
      "SELECT id, ts, mint, symbol, delta_usd, kind FROM wallet_events WHERE trader_id = ? ORDER BY ts DESC LIMIT 15"
    )
    .all(trader.id) as { id: number; ts: number; mint: string; symbol: string; delta_usd: number; kind: string }[];

  const inBaskets = db
    .prepare(
      `SELECT b.id, b.name, bt.weight FROM basket_traders bt
       JOIN baskets b ON b.id = bt.basket_id WHERE bt.trader_id = ? AND b.is_public = 1
       ORDER BY bt.weight DESC LIMIT 10`
    )
    .all(trader.id) as { id: number; name: string; weight: number }[];

  const kolscanRows: { label: string; s: KolPeriod | undefined }[] = [
    { label: "24h", s: seed.daily },
    { label: "7d", s: seed.weekly },
    { label: "30d", s: seed.monthly },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/" className="text-xs text-ink3 hover:text-ink">← Markets</Link>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <TokenIcon src={trader.pfp} symbol={trader.name} size={52} className="rounded-full" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display text-[28px]">{trader.name}</h1>
            {trader.listed === 1 && <span className="chip">KOLSCAN</span>}
            <span className="chip capitalize">{trader.label}</span>
            {trader.twitter && (
              <a href={trader.twitter} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                X profile ↗
              </a>
            )}
            <a
              href={`https://solscan.io/account/${trader.wallet}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand hover:underline"
            >
              Solscan ↗
            </a>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-ink3">{trader.wallet}</p>
        </div>
        <div className="ml-auto text-right">
          <div className="num text-2xl font-semibold">
            {value ? fmtUsd(value.totalUsd, { compact: true }) : "—"}
          </div>
          <div className="th">tracked value</div>
        </div>
      </div>

      <div className="statbar num mt-6 text-[13px]">
        <div><span className="th mr-2">SOL held</span>{value ? value.solAmount.toFixed(1) : "—"}</div>
        <div><span className="th mr-2">Live 24h</span>{ret24h != null ? fmtPct(ret24h) : "building…"}</div>
        <div><span className="th mr-2">Live 7d</span>{ret7d != null ? fmtPct(ret7d) : "building…"}</div>
        {kolscanRows.map((r) => (
          <div key={r.label}>
            <span className="th mr-2">Kolscan {r.label}</span>
            {r.s ? (
              <>
                <span className={r.s.profit >= 0 ? "text-good" : "text-bad"}>
                  {r.s.profit >= 0 ? "+" : ""}{r.s.profit.toFixed(1)} SOL
                </span>{" "}
                <span className="text-ink3">({r.s.wins}W/{r.s.losses}L)</span>
              </>
            ) : (
              "—"
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-ink2">Tracked wallet value</h2>
          {snapshots.length >= 2 ? (
            <LineChart points={snapshots} format="usd-compact" height={260} />
          ) : (
            <div className="flex h-[260px] items-center justify-center text-center text-sm text-ink3">
              Tracking just started — the curve builds from on-chain snapshots (~every 5 minutes).
            </div>
          )}
          <p className="mt-2 text-[11px] text-ink3">
            On-chain value: SOL + stables + tracked-universe tokens, snapshotted while the app runs.
            Deposits and withdrawals into the wallet appear as value changes.
          </p>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink2">Top holdings</h2>
            {value && value.holdings.length > 0 ? (
              <ul className="divide-y divide-hairline text-[13px]">
                {value.holdings.slice(0, 8).map((h) => (
                  <li key={h.mint}>
                    <Link href={`/tokens/${h.mint}`} className="flex items-center justify-between py-1.5 hover:text-brand">
                      <span className="font-medium">{h.symbol ?? mintSymbol(h.mint)}</span>
                      <span className="num text-ink2">{fmtUsd(h.valueUsd, { compact: true })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink3">No tracked token positions right now (SOL and untracked dust excluded).</p>
            )}
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink2">In baskets</h2>
            {inBaskets.length === 0 ? (
              <p className="text-[13px] text-ink3">
                Not in any public basket —{" "}
                <Link href="/baskets/new" className="text-brand hover:underline">build one around them</Link>.
              </p>
            ) : (
              <ul className="divide-y divide-hairline text-[13px]">
                {inBaskets.map((b) => (
                  <li key={b.id}>
                    <Link href={`/baskets/${b.id}`} className="flex items-center justify-between py-1.5 hover:text-brand">
                      <span className="truncate">{b.name}</span>
                      <span className="num text-ink3">{(b.weight * 100).toFixed(0)}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink2">Detected activity</h2>
            {events.length === 0 ? (
              <p className="text-[13px] text-ink3">No position changes detected yet.</p>
            ) : (
              <ul className="divide-y divide-hairline text-[13px]">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-1.5">
                    <span className={e.kind === "buy" ? "text-good" : "text-bad"}>
                      {e.kind === "buy" ? "▲" : "▼"}
                    </span>
                    <Link href={`/tokens/${e.mint}`} className="font-medium hover:text-brand">{e.symbol}</Link>
                    <span className="num ml-auto text-ink2">
                      {e.delta_usd > 0 ? "+" : "−"}{fmtUsd(Math.abs(e.delta_usd), { compact: true })}
                    </span>
                    <span className="num w-14 text-right text-xs text-ink3">{timeAgo(e.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
