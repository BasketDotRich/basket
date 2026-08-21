import Link from "next/link";
import {
  CREATION_FEE_SOL,
  PERFORMANCE_FEE_BPS,
  getTreasuryStats,
  solPriceUsd,
  treasuryWallet,
} from "@/lib/treasury";
import { fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fees",
  description:
    "Exactly what Basket charges, what it never charges on, and where every lamport of it goes — with the live ledger to check it against.",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="th text-[11px] text-brand">{"//"} {children}</div>;
}

const SWAP_FEE_PCT = 0.5;

export default async function FeesPage() {
  const [stats, sol] = await Promise.all([getTreasuryStats(), solPriceUsd()]);
  const treasuryAddr = treasuryWallet();

  const charges = [
    {
      name: "Swap fee",
      amount: `${SWAP_FEE_PCT}%`,
      when: "on every buy and every sell",
      detail:
        "Taken in SOL, off the top when you buy and out of the proceeds when you sell. It is the same on any token, including one listed ten minutes ago.",
    },
    {
      name: "Performance fee",
      amount: `${PERFORMANCE_FEE_BPS / 100}%`,
      when: "of realised profit only",
      detail:
        "Charged when you close a position in the green, on the gain alone. Exit flat or down and this is zero.",
    },
    {
      name: "Basket creation",
      amount: `${CREATION_FEE_SOL} SOL`,
      when: "once, when you publish a basket",
      detail:
        "A one-off cost to put a basket on the site. Nothing recurring, and nothing charged to people who invest in it.",
    },
  ];

  const never = [
    ["Your principal", "The performance fee touches gains only. The money you put in is never taxed."],
    ["A losing trade", "Exit down and you pay no performance fee. Only the swap fee applies, because that is an actual cost of routing."],
    ["Holding", "No management fee, no subscription, no monthly anything. A position can sit for a year and cost nothing."],
    ["Deposits or withdrawals", "Free. You pay only the Solana network fee, a fraction of a cent."],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Eyebrow>FEES</Eyebrow>
      <h1 className="display mt-2 text-[40px]">What we charge, and where it goes</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink2">
        Three charges, no others. Every one is itemised on the{" "}
        <Link href="/treasury" className="text-brand hover:underline">public ledger</Link> with the
        on-chain signature that settled it, so you can check this page against the chain rather
        than take our word for it.
      </p>

      {/* the three charges */}
      <div className="card mt-8 overflow-hidden">
        {charges.map((c) => (
          <div key={c.name} className="border-b border-hairline p-5 last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold text-ink">{c.name}</span>
              <span className="num text-[17px] text-brand">{c.amount}</span>
            </div>
            <div className="th mt-1">{c.when}</div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink2">{c.detail}</p>
          </div>
        ))}
      </div>

      {/* what is never charged */}
      <div className="mt-12">
        <Eyebrow>NEVER CHARGED ON</Eyebrow>
        <h2 className="display mt-2 text-[26px]">Four things that are always free</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {never.map(([title, body]) => (
            <div key={title} className="card p-4">
              <div className="text-[13.5px] font-semibold text-ink">{title}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* where it goes */}
      <div className="mt-12">
        <Eyebrow>WHERE IT GOES</Eyebrow>
        <h2 className="display mt-2 text-[26px]">Every fee funds buyback &amp; burn</h2>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
          Fees are not paid out to a team wallet. They go to the protocol treasury and work:
        </p>

        <ol className="mt-5 space-y-3">
          {[
            ["Fees land as SOL", "Swap, performance and creation fees settle into the treasury wallet on-chain."],
            ["The treasury deploys them", "Idle revenue is invested into the best-performing public baskets — the same baskets anyone can buy, through the same code."],
            ["Profit is realised", "Positions harvest at +25% and stop out at −40%. Only the profit is taken; the principal recycles into the next deployment."],
            ["Profit buys back and burns", "Realised profit is queued to buy $BASKET off the market and burn it — permanently reducing supply."],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-3">
              <span className="num shrink-0 text-[13px] font-semibold text-brand">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div className="text-[13.5px] font-semibold text-ink">{title}</div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-ink2">{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* live numbers */}
      <div className="mt-12">
        <Eyebrow>LIVE</Eyebrow>
        <h2 className="display mt-2 text-[26px]">The numbers, right now</h2>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
          {[
            ["Fees collected", fmtUsd(stats.totalInflow)],
            ["Collected on-chain", `${stats.collectedSol.toFixed(4)} SOL`],
            ["Queued for burn", fmtUsd(stats.pendingBurn)],
            ["Burned to date", fmtUsd(stats.burned)],
          ].map(([label, value]) => (
            <div key={label} className="bg-card px-4 py-3.5">
              <div className="th">{label}</div>
              <div className="num mt-1 text-[18px] font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink3">
          Updated from the same database that moves the money.{" "}
          {sol ? `${CREATION_FEE_SOL} SOL is about ${fmtUsd(CREATION_FEE_SOL * sol)} today. ` : ""}
          See every row on the{" "}
          <Link href="/treasury" className="text-brand hover:underline">treasury ledger</Link>.
        </p>
      </div>


      {/* the address itself — the point of "verifiable" */}
      {treasuryAddr && (
        <div className="card mt-8 p-5">
          <Eyebrow>VERIFY IT YOURSELF</Eyebrow>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">
            This is the treasury wallet. Every fee on this page settled into it on-chain. You do
            not have to trust the numbers above — open it on Solscan and read the balance and
            every transaction directly.
          </p>
          <code className="num mt-3 block overflow-x-auto rounded-lg border border-hairline bg-card2 px-3 py-2.5 text-[12.5px] text-ink">
            {treasuryAddr}
          </code>
          <a
            href={`https://solscan.io/account/${treasuryAddr}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost mt-3 inline-block rounded-lg px-4 py-2 text-[13px]"
          >
            Open treasury on Solscan ↗
          </a>
        </div>
      )}

      {/* honest status */}
      <div className="mt-12 rounded-lg border border-gold/30 bg-gold/5 p-5">
        <Eyebrow>STATUS — READ THIS</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Fee collection and treasury deployment are <strong className="text-ink">live and
          running</strong> — every figure above is real, taken from real transactions.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          The final step is <strong className="text-gold">not live yet</strong>: $BASKET has not
          launched, so nothing can be bought back or burned. Profit accrues as a queue —
          &ldquo;Queued for burn&rdquo; above is exactly what the burn engine will execute
          against on day one. We would rather show you a zero in &ldquo;Burned to date&rdquo; than
          a number that hasn&apos;t happened.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/treasury" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          See the live ledger
        </Link>
        <Link href="/tokenomics" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Tokenomics
        </Link>
        <Link href="/docs" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Full docs
        </Link>
      </div>
    </div>
  );
}
