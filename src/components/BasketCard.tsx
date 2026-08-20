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

export function BasketCard({ basket }: { basket: BasketCardData }) {
  const members =
    basket.kind === "coin"
      ? (basket.tokens ?? []).map((t) => t.symbol)
      : (basket.traders ?? []).map((t) => t.name);
  return (
    <Link
      href={`/baskets/${basket.id}`}
      className="card group flex flex-col p-4 transition hover:border-brand/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold group-hover:text-brand">{basket.name}</h3>
            {basket.mine && (
              <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                yours
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink3">
            <span>
              {basket.kind === "trader" ? "Trader basket · on-chain" : "Coin basket · live prices"} ·{" "}
              {members.length} {basket.kind === "trader" ? "wallets" : "assets"}
            </span>
            {basket.horizon === "short" && <span className="chip">SHORT-TERM</span>}
            {basket.horizon === "long" && <span className="chip">LONG HOLD</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Delta value={basket.change24h} className="text-sm" />
          <div className="th mt-0.5">24h</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {basket.kind === "coin"
            ? (basket.tokens ?? []).slice(0, 7).map((t) => (
                <TokenIcon
                  key={t.mint}
                  src={t.icon}
                  symbol={t.symbol}
                  size={24}
                  className="rounded-full ring-2 ring-card"
                />
              ))
            : (basket.traders ?? []).slice(0, 7).map((t) => (
                <TokenIcon
                  key={t.id}
                  src={t.pfp ?? null}
                  symbol={t.name}
                  size={24}
                  className="rounded-full ring-2 ring-card"
                />
              ))}
        </div>
        <span className="truncate text-xs text-ink3">{members.slice(0, 4).join(" · ")}</span>
      </div>

      {basket.description && (
        <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-ink2">{basket.description}</p>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-hairline pt-3 text-xs text-ink3">
        <span>by @{basket.owner_name ?? "?"}</span>
        <span className="tabular-nums">
          {basket.investors} investor{basket.investors === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}
