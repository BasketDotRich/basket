import Link from "next/link";
import { Delta } from "./Delta";
import { TokenIcon } from "./TokenIcon";

export type BasketCardData = {
  id: number;
  kind: "coin" | "trader";
  name: string;
  description: string;
  horizon?: "short" | "long" | null;
  owner_name?: string;
  change24h: number | null;
  investors: number;
  mine?: boolean;
  tokens?: { mint: string; symbol: string; icon: string | null; weight?: number }[];
  traders?: { id: number; name: string; pfp?: string | null; weight?: number }[];
};

/** Slice colours — the same series palette the donut and charts use. */
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

export function BasketCard({ basket }: { basket: BasketCardData }) {
  const isCoin = basket.kind === "coin";
  const members = isCoin ? (basket.tokens ?? []) : (basket.traders ?? []);
  const names = isCoin
    ? (basket.tokens ?? []).map((t) => t.symbol)
    : (basket.traders ?? []).map((t) => t.name);

  // normalise weights so the composition bar always fills the card
  const weights = members.map((m) => m.weight ?? 0);
  const total = weights.reduce((s, w) => s + w, 0);
  const bar =
    total > 0
      ? members.map((m, i) => ({ pct: ((m.weight ?? 0) / total) * 100, color: SERIES[i % SERIES.length] }))
      : members.map((_, i) => ({ pct: 100 / members.length, color: SERIES[i % SERIES.length] }));

  const up = (basket.change24h ?? 0) > 0;

  return (
    <Link
      href={`/baskets/${basket.id}`}
      className="card lift group relative flex flex-col overflow-hidden p-4"
    >
      {/* performance wash — the card itself carries the day's mood */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(120% 100% at 50% 0%, ${
            basket.change24h == null ? "rgba(120,130,150,0.10)" : up ? "rgba(34,197,94,0.13)" : "rgba(240,69,63,0.13)"
          }, transparent 70%)`,
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[15.5px] font-semibold transition-colors group-hover:text-brand">
              {basket.name}
            </h3>
            {basket.mine && <span className="chip chip-on">YOURS</span>}
            {basket.horizon === "short" && <span className="chip">SHORT-TERM</span>}
            {basket.horizon === "long" && <span className="chip">LONG HOLD</span>}
          </div>
          <p className="th mt-1">
            {isCoin ? `${names.length} tokens · live` : `${names.length} wallets · tracking`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Delta value={basket.change24h} className="text-[15px] font-semibold" />
          <div className="th mt-0.5">24h</div>
        </div>
      </div>

      {/* composition bar: the weights, at a glance */}
      <div className="relative mt-3.5 flex h-1.5 gap-px overflow-hidden rounded-full">
        {bar.map((s, i) => (
          <span key={i} style={{ width: `${s.pct}%`, background: s.color }} className="block h-full" />
        ))}
      </div>

      <div className="relative mt-3 flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {isCoin
            ? (basket.tokens ?? []).slice(0, 6).map((t) => (
                <TokenIcon
                  key={t.mint}
                  src={t.icon}
                  mint={t.mint}
                  symbol={t.symbol}
                  size={24}
                  className="rounded-full ring-2 ring-card transition-transform group-hover:translate-y-[-1px]"
                />
              ))
            : (basket.traders ?? []).slice(0, 6).map((t) => (
                <TokenIcon
                  key={t.id}
                  src={t.pfp ?? null}
                  symbol={t.name}
                  size={24}
                  className="rounded-full ring-2 ring-card transition-transform group-hover:translate-y-[-1px]"
                />
              ))}
          {names.length > 6 && (
            <span className="num flex h-6 w-6 items-center justify-center rounded-full bg-card3 text-[10px] text-ink3 ring-2 ring-card">
              +{names.length - 6}
            </span>
          )}
        </div>
        <span className="num truncate text-[11px] text-ink3">{names.slice(0, 3).join(" · ")}</span>
      </div>

      {basket.description && (
        <p className="relative mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-ink2">
          {basket.description}
        </p>
      )}

      <div className="relative mt-auto flex items-center justify-between border-t border-hairline pt-3 text-[11px] text-ink3">
        <span>by @{basket.owner_name ?? "?"}</span>
        <span className="flex items-center gap-2.5">
          <span className="num">
            {basket.investors} holder{basket.investors === 1 ? "" : "s"}
          </span>
          <span className="text-brand opacity-0 transition-opacity group-hover:opacity-100">
            {isCoin ? "Trade →" : "View →"}
          </span>
        </span>
      </div>
    </Link>
  );
}
