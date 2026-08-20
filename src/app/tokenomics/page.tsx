import Link from "next/link";
import { CREATION_FEE_SOL, PERFORMANCE_FEE_BPS, getTreasuryStats, solPriceUsd } from "@/lib/treasury";
import { fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tokenomics — Basket",
  description:
    "Every fee Basket earns buys the platform token back off the market and burns it. 10% of realised profit + 0.5 SOL per basket, all on an on-chain ledger.",
};

/** Mono comment-style eyebrow — the section voice of this page. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="th text-[11px] text-brand">{"//"} {children}</div>;
}

export default async function TokenomicsPage() {
  const [stats, sol] = await Promise.all([getTreasuryStats(), solPriceUsd()]);

  const pipeline = [
    {
      label: "SOURCES",
      title: `${PERFORMANCE_FEE_BPS / 100}% of realised profit + ${CREATION_FEE_SOL} SOL per basket`,
      sub: "profit only — never principal, never a loss",
    },
    {
      label: "ROUTE",
      title: "Protocol treasury",
      sub: "itemised on the public ledger",
    },
    {
      label: "PROOF",
      title: "On-chain, itemised",
      sub: "every fee row carries its signature",
    },
    {
      label: "RESULT",
      title: "Buyback & burn",
      sub: "supply removed forever",
    },
  ];

  const glance = [
    ["CHAIN", "Solana · SPL"],
    ["LAUNCH", "Fair — pump.fun curve, like the coins we index"],
    ["PRE-MINE / TEAM / VC", "None"],
    ["EMISSION", "None — no inflation"],
    ["VALUE ENGINE", "Buyback-and-burn"],
    ["BUYBACK SOURCE", `${PERFORMANCE_FEE_BPS / 100}% performance fee + 0.5% swap fee + ${CREATION_FEE_SOL} SOL creation fee`],
    ["FEES ACCRUED TO DATE", fmtUsd(stats.totalInflow)],
    ["QUEUED FOR BURN", fmtUsd(stats.pendingBurn)],
  ];

  const utility = [
    {
      n: "01",
      title: "Fee → buyback → burn",
      body: "Every profitable redeem and every basket created removes supply. Accrual scales with real usage, never with emissions.",
    },
    {
      n: "02",
      title: "Swap fee, both ways",
      body: "0.5% routes to the protocol on every buy and every sell, on top of the performance fee. Volume funds the burn even in a flat market.",
    },
    {
      n: "03",
      title: "Public ledger",
      body: "Every fee and burn is a row on the treasury page with its on-chain signature, live from the same database that moves the money.",
    },
    {
      n: "04",
      title: "Creator alignment",
      body: "The 0.5 SOL creation fee routes 100% to buyback & burn — the more baskets the trenches build, the less supply survives.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <Eyebrow>TOKENOMICS · V1</Eyebrow>

      {/* pill-ringed display mark, brand-blue */}
      <div className="mt-4 inline-block rounded-full border-2 border-brand/60 px-8 py-3">
        <h1 className="display neon-brand text-[56px] leading-none sm:text-[72px]">$BASKET</h1>
      </div>

      <p className="num mt-6 max-w-2xl text-[15px] leading-relaxed text-ink2">
        All the value comes from one place: the protocol&apos;s real revenue buying the token back
        off the market and burning it. No pre-mine, no team bag, no emissions.
      </p>

      {/* value engine pipeline */}
      <div className="mt-14">
        <Eyebrow>VALUE ENGINE</Eyebrow>
        <p className="mt-1 text-sm text-ink3">The app already earns. That revenue destroys supply.</p>
        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
          {pipeline.map((s, i) => (
            <div key={s.label} className="relative bg-card px-4 py-5">
              <div className="th text-[10px]">{"//"} {s.label}</div>
              <div className="mt-2 text-[13.5px] font-semibold leading-snug">{s.title}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-ink3">{s.sub}</div>
              {i < pipeline.length - 1 && (
                <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-lg text-brand sm:block">
                  →
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink3">
          The fee engine is live in the product today — every figure above accrues on the{" "}
          <Link href="/treasury" className="text-brand hover:underline">
            public treasury ledger
          </Link>{" "}
          before the token exists, so the burn engine launches with a balance, not a promise.
        </p>
      </div>

      {/* at a glance spec card */}
      <div className="mt-14">
        <Eyebrow>AT A GLANCE</Eyebrow>
        <p className="mt-1 text-sm text-ink3">The whole model, on one card.</p>
        <div className="card mt-5 overflow-hidden">
          {glance.map(([k, v]) => (
            <div
              key={k}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline px-5 py-3 last:border-0"
            >
              <span className="th">{k}</span>
              <span className="num text-[13px] text-ink">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* utility */}
      <div className="mt-14">
        <Eyebrow>UTILITY</Eyebrow>
        <p className="mt-1 text-sm text-ink3">What the engine does with every fee.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {utility.map((u) => (
            <div key={u.n} className="card p-5">
              <div className="num text-[22px] font-semibold text-brand">{u.n}</div>
              <h2 className="mt-2 text-[14.5px] font-semibold">{u.title}</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{u.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* honest status */}
      <div className="mt-14 rounded-lg border border-gold/30 bg-gold/5 p-5">
        <Eyebrow>STATUS</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          The economic engine — performance fees and creation fees, collected on-chain — is live in the
          product today{sol ? ` (${CREATION_FEE_SOL} SOL ≈ ${fmtUsd(CREATION_FEE_SOL * sol)} right now)` : ""}.
          The token itself is <strong className="text-gold">not yet launched</strong>; when it is,
          it launches fair with no pre-mine. This page is the source of truth for the model — no
          figure here is a price or a promise of one.
        </p>
      </div>

      <div className="mt-10 flex gap-3">
        <Link href="/treasury" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          See the live ledger
        </Link>
        <Link href="/baskets" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Browse baskets
        </Link>
      </div>
    </div>
  );
}
