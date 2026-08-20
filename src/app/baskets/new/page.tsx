"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cls, fmtPct, fmtUsd } from "@/lib/format";
import { TokenIcon } from "@/components/TokenIcon";
import { TokenPicker } from "@/components/TokenPicker";
import { Delta } from "@/components/Delta";

type UniverseToken = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  price: number | null;
  change24h: number | null;
  mcap: number | null;
  verified?: boolean;
  curated?: boolean;
};

type KolPeriod = { profit: number; wins: number; losses: number };
type RosterTrader = {
  id: number;
  name: string;
  wallet: string;
  label: string;
  bio: string;
  twitter: string | null;
  pfp: string | null;
  listed: boolean;
  sourceUrl: string | null;
  seedStats: { daily?: KolPeriod; weekly?: KolPeriod; monthly?: KolPeriod } | null;
  valueUsd: number | null;
  ret24h: number | null;
};

type Pick = { key: string; label: string; sub: string; icon: string | null; emoji?: string; weight: number };

export default function NewBasketPage() {
  const router = useRouter();
  const [kind, setKind] = useState<"coin" | "trader">("coin");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const [universe, setUniverse] = useState<UniverseToken[]>([]);
  const [roster, setRoster] = useState<RosterTrader[]>([]);
  const [kolQuery, setKolQuery] = useState("");

  const [picks, setPicks] = useState<Pick[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [horizon, setHorizon] = useState<"short" | "long" | null>(null);
  const emoji = "🧺"; // kept for the API contract; no longer shown in the UI
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // custom wallet form (trader mode)
  const [walletAddr, setWalletAddr] = useState("");
  const [walletName, setWalletName] = useState("");
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setSignedIn(d.user != null));
    fetch("/api/tokens").then((r) => r.json()).then((d) => setUniverse(d.tokens ?? []));
    fetch("/api/traders")
      .then((r) => r.json())
      .then((d) => {
        const list: RosterTrader[] = d.traders ?? [];
        list.sort(
          (a, b) => (b.seedStats?.monthly?.profit ?? -1) - (a.seedStats?.monthly?.profit ?? -1)
        );
        setRoster(list);
      });
  }, []);

  const totalWeight = useMemo(
    () => picks.reduce((s, p) => s + p.weight, 0),
    [picks]
  );
  const zeroWeights = picks.filter((p) => p.weight <= 0);
  const weightOk = Math.abs(totalWeight - 100) <= 0.5 && zeroWeights.length === 0;

  function addPick(p: Omit<Pick, "weight">) {
    setPicks((prev) => {
      if (prev.some((x) => x.key === p.key) || prev.length >= 10) return prev;
      const next = [...prev, { ...p, weight: 0 }];
      const equal = Math.floor(1000 / next.length) / 10;
      return next.map((x, i) => ({
        ...x,
        weight: i === next.length - 1 ? Math.round((100 - equal * (next.length - 1)) * 10) / 10 : equal,
      }));
    });
  }

  function removePick(key: string) {
    setPicks((prev) => prev.filter((x) => x.key !== key));
  }

  function setWeight(key: string, w: number) {
    setPicks((prev) => prev.map((x) => (x.key === key ? { ...x, weight: w } : x)));
  }

  function equalize() {
    setPicks((prev) => {
      if (prev.length === 0) return prev;
      const equal = Math.floor(1000 / prev.length) / 10;
      return prev.map((x, i) => ({
        ...x,
        weight: i === prev.length - 1 ? Math.round((100 - equal * (prev.length - 1)) * 10) / 10 : equal,
      }));
    });
  }

  function switchKind(k: "coin" | "trader") {
    if (k !== kind) {
      setKind(k);
      setPicks([]);
      setError(null);
    }
  }

  async function addWallet() {
    setWalletBusy(true);
    setWalletErr(null);
    try {
      const res = await fetch("/api/traders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr, name: walletName }),
      });
      const d = await res.json();
      if (!res.ok) {
        setWalletErr(d.error ?? "Could not add wallet");
        return;
      }
      try {
        const rosterRes = await fetch("/api/traders").then((r) => r.json());
        setRoster(rosterRes.traders ?? []);
        const added = (rosterRes.traders ?? []).find((t: RosterTrader) => t.id === d.id);
        if (added) {
          addPick({
            key: `trader:${added.id}`,
            label: added.name,
            sub: "community wallet",
            icon: null,
          });
        } else {
          setWalletErr("Wallet was added — search for it in the roster to include it.");
        }
      } catch {
        setWalletErr("Wallet was added, but the roster didn’t refresh — search for it above.");
      }
      setWalletAddr("");
      setWalletName("");
    } catch {
      setWalletErr("Network error — try again");
    } finally {
      setWalletBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body =
        kind === "coin"
          ? {
              kind,
              name,
              description,
              emoji,
              horizon,
              tokens: picks.map((p) => ({ mint: p.key.slice(5), weight: p.weight })),
            }
          : {
              kind,
              name,
              description,
              emoji,
              horizon,
              traders: picks.map((p) => ({ id: Number(p.key.slice(7)), weight: p.weight })),
            };
      const res = await fetch("/api/baskets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not create basket");
        return;
      }
      router.push(`/baskets/${d.id}`);
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="display text-[34px]">Create a basket</h1>
      <p className="mt-1 text-sm text-ink3">
        Any Solana token can go in — curated graduates, whatever’s trending, or paste a mint address. Weights must add up to 100%.
      </p>
      <p className="mt-2 inline-flex items-center gap-2 rounded-md border border-hairline bg-card px-3 py-1.5 text-xs text-ink2">
        <span className="chip">0.5 SOL</span>
        creation fee — 100% goes to{" "}
        <Link href="/treasury" className="text-brand hover:underline">buyback &amp; burn</Link>
      </p>

      {signedIn === false && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          You need an account to create baskets —{" "}
          <Link href="/register" className="underline">sign up free</Link> — every account gets its own Solana wallet, plus a $10,000 practice balance to test strategies.
        </div>
      )}

      <div className="mt-6 flex w-fit rounded-xl border border-hairline bg-card p-1 text-sm font-medium">
        {(
          [
            ["coin", "Coin basket"],
            ["trader", "Trader basket"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => switchKind(k)}
            className={cls(
              "rounded-lg px-4 py-2 transition",
              kind === k ? "bg-card2 text-ink" : "text-ink3 hover:text-ink2"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ------- left: universe ------- */}
        <div>
          {kind === "coin" ? (
            <TokenPicker
              curated={universe}
              isPicked={(mint) => picks.some((p) => p.key === `coin:${mint}`)}
              onPick={(t) =>
                addPick({ key: `coin:${t.mint}`, label: t.symbol, sub: t.name, icon: t.icon })
              }
            />
          ) : (
            <>
              <input
                value={kolQuery}
                onChange={(e) => setKolQuery(e.target.value)}
                placeholder={`Search ${roster.length} Kolscan wallets…`}
                className="mb-2 w-full rounded-lg border border-hairline bg-card px-4 py-2.5 text-sm outline-none placeholder:text-ink3 focus:border-brand"
              />
              <div className="max-h-[430px] space-y-1.5 overflow-y-auto pr-1">
                {roster.length === 0 && (
                  <p className="py-8 text-center text-sm text-ink3">Loading tracked wallets…</p>
                )}
                {roster
                  .filter(
                    (t) =>
                      !kolQuery.trim() ||
                      t.name.toLowerCase().includes(kolQuery.trim().toLowerCase()) ||
                      t.wallet.startsWith(kolQuery.trim())
                  )
                  .slice(0, 80)
                  .map((t) => {
                  const key = `trader:${t.id}`;
                  const added = picks.some((p) => p.key === key);
                  const m = t.seedStats?.monthly;
                  return (
                    <button
                      key={t.id}
                      disabled={added}
                      onClick={() =>
                        addPick({ key, label: t.name, sub: t.label, icon: t.pfp })
                      }
                      className={cls(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                        added
                          ? "border-brand/40 bg-brand/10 opacity-60"
                          : "border-hairline bg-card hover:border-brand/60"
                      )}
                    >
                      <TokenIcon src={t.pfp} symbol={t.name} size={30} className="rounded-full" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium leading-tight">
                          {t.name}
                          {t.listed && <span className="chip">KOLSCAN</span>}
                        </span>
                        <span className="block truncate text-xs leading-tight text-ink3">
                          <span className="capitalize">{t.label}</span>
                          {m && <> · 30d {m.wins}W/{m.losses}L</>}
                        </span>
                      </span>
                      <span className="ml-auto text-right">
                        {m ? (
                          <span className="num block text-sm text-good">+{m.profit.toFixed(0)} SOL</span>
                        ) : t.valueUsd != null ? (
                          <span className="num block text-sm">{fmtUsd(t.valueUsd, { compact: true })}</span>
                        ) : (
                          <span className="block text-sm text-ink3">—</span>
                        )}
                        <span className="block text-[10px] uppercase tracking-wide text-ink3">
                          {m ? "30d pnl" : "tracked"}
                        </span>
                      </span>
                      <span className="ml-2 text-lg text-ink3">{added ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 rounded-lg border border-hairline bg-card p-4">
                <h3 className="text-sm font-semibold text-ink2">Track any wallet</h3>
                <p className="mt-1 text-xs text-ink3">
                  Add any Solana wallet to the roster — its on-chain value is tracked from the
                  moment it joins.
                </p>
                <div className="mt-3 space-y-2">
                  <input
                    value={walletAddr}
                    onChange={(e) => setWalletAddr(e.target.value.trim())}
                    placeholder="Wallet address"
                    className="w-full rounded-lg border border-hairline bg-card2 px-3 py-2 text-sm outline-none placeholder:text-ink3 focus:border-brand"
                  />
                  <div className="flex gap-2">
                    <input
                      value={walletName}
                      onChange={(e) => setWalletName(e.target.value)}
                      placeholder="Nickname (optional)"
                      className="min-w-0 flex-1 rounded-lg border border-hairline bg-card2 px-3 py-2 text-sm outline-none placeholder:text-ink3 focus:border-brand"
                    />
                    <button
                      onClick={addWallet}
                      disabled={walletBusy || walletAddr.length < 32}
                      className="btn-brand rounded-lg px-4 py-2 text-sm font-semibold"
                    >
                      {walletBusy ? "Adding…" : "Add"}
                    </button>
                  </div>
                  {walletErr && <p className="text-xs text-bad">⚠ {walletErr}</p>}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ------- right: composition ------- */}
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink2">
                Your picks ({picks.length}/10)
              </h2>
              <button
                onClick={equalize}
                disabled={picks.length === 0}
                className="rounded-full border border-hairline px-3 py-1 text-xs text-ink2 hover:border-brand disabled:opacity-40"
              >
                Equal weights
              </button>
            </div>

            {picks.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink3">
                {kind === "coin" ? "Add at least 2 tokens from the left" : "Add at least 2 traders from the left"}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {picks.map((p) => (
                  <div key={p.key} className="flex items-center gap-3">
                    {p.emoji ? (
                      <span className="text-xl">{p.emoji}</span>
                    ) : (
                      <TokenIcon src={p.icon} symbol={p.label} size={26} />
                    )}
                    <span className="w-24 truncate text-sm font-medium">{p.label}</span>
                    <input
                      type="range"
                      aria-label={`Weight of ${p.label}`}
                      min={1}
                      max={97}
                      step={1}
                      value={Math.round(p.weight)}
                      onChange={(e) => setWeight(p.key, Number(e.target.value))}
                      className="min-w-0 flex-1"
                    />
                    <input
                      inputMode="decimal"
                      value={p.weight}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v <= 100) setWeight(p.key, v);
                      }}
                      className="w-16 rounded-lg border border-hairline bg-card2 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand"
                    />
                    <span className="text-xs text-ink3">%</span>
                    <button onClick={() => removePick(p.key)} className="text-ink3 hover:text-bad" aria-label={`Remove ${p.label}`}>
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-3 border-t border-hairline pt-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-card2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(totalWeight, 100)}%`,
                        background: weightOk ? "var(--good)" : "var(--warn)",
                      }}
                    />
                  </div>
                  <span className={cls("text-sm tabular-nums", weightOk ? "text-good" : "text-warn")}>
                    {fmtPct(totalWeight, false)}{" "}
                    {weightOk
                      ? "✓"
                      : zeroWeights.length > 0
                        ? `→ ${zeroWeights[0].label} is at 0%`
                        : "→ need 100%"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="card space-y-4 p-5">
            <div>
              <label className="text-xs uppercase tracking-wider text-ink3">Basket name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === "coin" ? "e.g. Cat Coin Supremacy" : "e.g. My Alpha Squad"}
                className="mt-1.5 w-full rounded-xl border border-hairline bg-card2 px-4 py-2.5 text-sm outline-none placeholder:text-ink3 focus:border-brand"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-ink3">Horizon</label>
              <div className="mt-1.5 flex gap-1.5">
                {([
                  [null, "None"],
                  ["short", "Short-term trench"],
                  ["long", "Long hold"],
                ] as const).map(([v, label]) => (
                  <button
                    key={label}
                    onClick={() => setHorizon(v)}
                    className={cls(
                      "flex-1 rounded-lg border px-2 py-1.5 text-xs",
                      horizon === v ? "border-brand bg-brand/15 text-ink" : "border-hairline text-ink2 hover:border-brand/50"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-ink3">
                Tells investors the intent — pair it with exit rules when investing.
              </p>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-ink3">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="What's the thesis?"
                className="mt-1.5 w-full resize-none rounded-xl border border-hairline bg-card2 px-4 py-2.5 text-sm outline-none placeholder:text-ink3 focus:border-brand"
              />
            </div>
            {error && <div className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">⚠ {error}</div>}
            <p className="text-[11px] leading-relaxed text-ink3">
              Creating charges the USD value of <strong className="text-ink2">0.5 SOL</strong> from your practice balance →
              buyback &amp; burn. Redeems pay a <strong className="text-ink2">10% fee on profit
              only</strong>.
            </p>
            <button
              onClick={create}
              disabled={busy || !signedIn || picks.length < 2 || !weightOk || name.trim().length < 3}
              className="btn-brand w-full rounded-xl py-3 text-sm font-semibold"
            >
              {busy ? "Creating…" : `Create ${kind === "coin" ? "coin" : "trader"} basket`}
            </button>
            {kind === "trader" && (
              <p className="text-xs text-ink3">
                Trader baskets track each wallet&apos;s real on-chain value (SOL, stables and
                tokens in the tracked universe). NAV history builds from the moment the basket is
                created.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
