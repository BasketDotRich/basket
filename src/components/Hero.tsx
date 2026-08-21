import Link from "next/link";
import { Counter } from "./Counter";
import { Delta } from "./Delta";
import { TokenIcon } from "./TokenIcon";
import { Sparkline } from "./Sparkline";
import { WeaveFloor } from "./WeaveFloor";
import { SpinRing } from "./SpinRing";
import { fmtUsd } from "@/lib/format";
import type { MarketRow } from "./MarketsTable";

export function Hero({
  signedIn,
  market,
  totalMcap,
  totalVol,
  kolCount,
  basketCount,
  topBasket,
}: {
  signedIn: boolean;
  market: MarketRow[];
  totalMcap: number;
  totalVol: number;
  kolCount: number;
  basketCount: number;
  topBasket: { id: number; name: string; change24h: number | null } | null;
}) {
  const movers = [...market]
    .filter((t) => t.change24h != null && Math.abs(t.change24h) < 400)
    .sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!))
    .slice(0, 4);

  return (
    <section className="relative overflow-hidden border-b border-hairline">
      <div className="hero-aura" />
      {/* signature surface: the weave, receding to a vanishing point */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[210px] overflow-hidden">
        {/* horizon line + bloom, then the weave receding from it */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8fb8ff]/70 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(61,125,255,0.28),transparent_70%)]" />
        <WeaveFloor className="h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-page/85 via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-[230px] pt-16 sm:pt-24">
        {/* the hero's physical object: spinning ring + tilted flagship card */}
        <div
          className="hero-object rise pointer-events-none absolute right-0 top-16"
          style={{ animationDelay: "300ms" }}
        >
          <SpinRing size={320} />
          {topBasket && (
            <Link
              href={`/baskets/${topBasket.id}`}
              className="tilt-card card pointer-events-auto absolute -bottom-10 -left-16 block w-[220px] p-4"
            >
              <div className="th">Flagship basket</div>
              <div className="mt-1 text-[15px] font-semibold">{topBasket.name}</div>
              <div className="mt-1.5 flex items-center justify-between">
                <Delta value={topBasket.change24h} suffix="24h" />
                <span className="text-[11px] text-brand">Trade →</span>
              </div>
            </Link>
          )}
        </div>
        <div className="rise flex flex-wrap items-center gap-2">
          <span className="chip chip-on">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            LIVE SOLANA DATA
          </span>
          <span className="chip">{market.length} TRACKED TOKENS</span>
          <span className="chip">{kolCount} TRACKED WALLETS</span>
        </div>

        <h1
          className="display rise mt-6 max-w-4xl lg:max-w-[58%]"
          style={{ animationDelay: "60ms", fontSize: "clamp(2.6rem, 7.5vw, 5.2rem)" }}
        >
          Buy the whole
          <br />
          <span className="neon-brand">trench</span> at once.
        </h1>

        <p
          className="rise mt-6 max-w-xl text-[15px] leading-relaxed text-ink2"
          style={{ animationDelay: "120ms" }}
        >
          Weighted index baskets of real Solana memecoins — every buy is a real
          on-chain swap from your own wallet. Track the KOL wallets that move
          them, and set exits that fire without you watching.
        </p>

        <div className="rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
          <Link
            href={signedIn ? "/baskets" : "/register"}
            className="btn-brand rounded-xl px-6 py-3 text-[14px]"
          >
            {signedIn ? "Browse baskets" : "Start trading"}
          </Link>
          <Link href="/baskets/new" className="btn-ghost rounded-xl px-6 py-3 text-[14px] font-medium">
            Build your own
          </Link>
        </div>

        {/* live figures carry the hero rather than decoration */}
        <div
          className="rise mt-12 grid grid-cols-2 gap-x-8 gap-y-7 sm:grid-cols-4"
          style={{ animationDelay: "240ms" }}
        >
          <div>
            <div className="th">Tracked market cap</div>
            <Counter
              value={totalMcap}
              format="compact"
              className="num mt-1.5 block text-[26px] font-semibold sm:text-[30px]"
            />
          </div>
          <div>
            <div className="th">24h volume</div>
            <Counter
              value={totalVol}
              format="compact"
              className="num mt-1.5 block text-[26px] font-semibold sm:text-[30px]"
            />
          </div>
          <div>
            <div className="th">KOL wallets</div>
            <Counter
              value={kolCount}
              format="int"
              className="num mt-1.5 block text-[26px] font-semibold sm:text-[30px]"
            />
          </div>
          <div>
            <div className="th">Live baskets</div>
            <Counter
              value={basketCount}
              format="int"
              className="num mt-1.5 block text-[26px] font-semibold sm:text-[30px]"
            />
          </div>
        </div>

        {/* movers strip */}
        <div
          className="rise mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          style={{ animationDelay: "300ms" }}
        >
          {movers.map((t) => (
            <Link
              key={t.mint}
              href={`/tokens/${t.mint}`}
              className="card lift flex items-center gap-3 px-3.5 py-3"
            >
              <TokenIcon src={t.icon} mint={t.mint} symbol={t.symbol} size={28} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{t.symbol}</div>
                <div className="num text-[11px] text-ink3">
                  {t.price != null ? fmtUsd(t.price) : "—"}
                </div>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1">
                <Delta value={t.change24h} className="num text-[12px]" />
                <Sparkline data={t.sparkline} width={54} height={16} />
              </div>
            </Link>
          ))}
        </div>

        {topBasket && (
          <div
            className="rise mt-3 flex items-center gap-3 text-[12.5px] text-ink3"
            style={{ animationDelay: "340ms" }}
          >
            <span className="th">Flagship</span>
            <Link href={`/baskets/${topBasket.id}`} className="text-ink2 hover:text-brand">
              {topBasket.name}
            </Link>
            <Delta value={topBasket.change24h} className="num text-[12px]" suffix="24h" />
          </div>
        )}
      </div>
    </section>
  );
}
