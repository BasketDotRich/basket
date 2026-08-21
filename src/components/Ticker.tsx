import { CURATED_TOKENS } from "@/lib/tokens";
import { getPrices } from "@/lib/prices";
import { fmtUsd } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";

export async function Ticker() {
  const top = CURATED_TOKENS.slice(0, 14);
  const prices = await getPrices(top.map((t) => t.mint));
  const items = top
    .map((t) => ({ ...t, p: prices[t.mint] }))
    .filter((t) => t.p != null);
  if (items.length === 0) return null;

  const row = (keyPrefix: string) =>
    items.map((t) => {
      const ch = t.p!.priceChange24h;
      const up = ch != null && ch > 0;
      const down = ch != null && ch < 0;
      return (
        <span key={`${keyPrefix}-${t.mint}`} className="flex shrink-0 items-center gap-2 px-5">
          <TokenIcon src={t.icon} mint={t.mint} symbol={t.symbol} size={18} />
          <span className="text-sm font-medium">{t.symbol}</span>
          <span className="text-sm tabular-nums text-ink2">{fmtUsd(t.p!.usdPrice)}</span>
          {ch != null && (
            <span className={`text-xs tabular-nums ${up ? "text-good" : down ? "text-bad" : "text-ink3"}`}>
              {up ? "▲" : down ? "▼" : "·"} {Math.abs(ch).toFixed(1)}%
            </span>
          )}
        </span>
      );
    });

  return (
    <div className="overflow-hidden border-b border-hairline bg-card/30 py-2">
      <div className="ticker-track flex w-max">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
