import Link from "next/link";
import { BasketCard } from "@/components/BasketCard";
import { getUser } from "@/lib/auth";
import {
  basketChange24h,
  getBasketTokens,
  getBasketTraders,
  investorCount,
  listBaskets,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function BasketsPage() {
  const user = await getUser();
  const all = listBaskets(user?.id ?? null);
  const enriched = await Promise.all(
    all.map(async (b) => ({
      ...b,
      tokens: b.kind === "coin" ? getBasketTokens(b.id) : [],
      traders: b.kind === "trader" ? getBasketTraders(b.id) : [],
      change24h: await basketChange24h(b),
      investors: investorCount(b.id),
      mine: user != null && b.owner_id === user.id,
    }))
  );

  const coins = enriched.filter((b) => b.kind === "coin");
  const traders = enriched.filter((b) => b.kind === "trader");
  const mine = enriched.filter((b) => b.mine);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[34px]">Baskets</h1>
          <p className="mt-1 text-sm text-ink3">
            Weighted baskets of real coins and real tracked wallets. Invest from your balance, or build your own.
          </p>
        </div>
        <Link href="/baskets/new" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          + Create basket
        </Link>
      </div>

      {mine.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold">Your baskets</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((b) => (
              <BasketCard key={b.id} basket={b} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Coin baskets</h2>
        <p className="mb-4 text-sm text-ink3">Baskets of Solana memecoins, priced on live markets.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coins.map((b) => (
            <BasketCard key={b.id} basket={b} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Trader baskets</h2>
        <p className="mb-4 text-sm text-ink3">
          Squads of real KOL wallets, tracked live on-chain.{" "}
          <span className="chip chip-gold">TRACKING ONLY</span>{" "}
          <span className="text-ink2">
            NAV follows each wallet&apos;s real value — copy-trade execution is coming.
          </span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {traders.map((b) => (
            <BasketCard key={b.id} basket={b} />
          ))}
        </div>
      </section>
    </div>
  );
}
