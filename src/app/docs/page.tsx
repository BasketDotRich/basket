import Link from "next/link";
import { CREATION_FEE_SOL, PERFORMANCE_FEE_BPS } from "@/lib/treasury";

export const metadata = {
  title: "How Basket works",
  description:
    "Plain-English docs: how baskets work, where your money actually goes, what the fees are, how exit rules fire, and what the bot can and can't do.",
};

/** Mono comment-style eyebrow — matches the tokenomics page voice. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="th text-[11px] text-brand">{"//"} {children}</div>;
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-hairline pt-10">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="display mt-2 text-[26px]">{title}</h2>
      <div className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-ink2">{children}</div>
    </section>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="num shrink-0 text-[13px] font-semibold text-brand">{n}</span>
      <div>
        <div className="text-[13.5px] font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-ink2">{children}</div>
      </div>
    </div>
  );
}

const TOC = [
  ["what-it-is", "What Basket actually is"],
  ["getting-started", "Getting started in 3 steps"],
  ["baskets", "Coin baskets"],
  ["traders", "Trader baskets (copy-trading)"],
  ["exit-rules", "Exit rules"],
  ["fees", "Fees, in full"],
  ["custody", "Your wallet & keys"],
  ["bot", "Telegram bot"],
  ["risks", "Risks — read this"],
  ["faq", "FAQ"],
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Eyebrow>DOCS</Eyebrow>
      <h1 className="display mt-2 text-[40px]">How Basket works</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink2">
        No jargon, no hand-waving. This page explains exactly what happens to your money at every
        step — including the parts most apps leave out.
      </p>

      {/* table of contents */}
      <nav className="card mt-8 p-4">
        <div className="th mb-2">On this page</div>
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-[13px] text-ink2 hover:text-brand">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-10 space-y-10">
        <Section id="what-it-is" eyebrow="THE IDEA" title="What Basket actually is">
          <p>
            Buying one memecoin is a coin flip. Buying ten is a thesis. A <strong className="text-ink">basket</strong> is
            a weighted group of Solana tokens you buy in a single action — say 25% ANSEM, 25%
            FARTCOIN, 20% JELLYJELLY, 15% ARC, 15% BAN.
          </p>
          <p>
            When you invest, Basket executes one real Jupiter swap per token, sized to its weight,
            straight from your wallet. <strong className="text-ink">The tokens land in your own
            wallet.</strong> Basket does not pool your money with anyone else&apos;s, does not issue
            you a share of a fund, and does not hold your tokens in some omnibus account. You own
            the coins directly — the app just remembers which ones belong to which thesis, so it can
            show you P&amp;L and fire your exit rules.
          </p>
          <p className="rounded-lg border border-hairline bg-card2 p-3 text-[12.5px]">
            <strong className="text-ink">There is no paper trading here.</strong> Every buy, sell and
            fee is a real on-chain transaction with a signature you can check on Solscan. If a number
            appears on this site, it came from the chain or from a live price feed.
          </p>
        </Section>

        <Section id="getting-started" eyebrow="START" title="Getting started in 3 steps">
          <div className="space-y-4">
            <Step n="01" title="Make an account">
              Email or Google. The moment you sign up, Basket generates a Solana wallet that belongs
              to your account — no extension to install, no seed phrase to write down.
            </Step>
            <Step n="02" title="Deposit SOL">
              Your <Link href="/wallet" className="text-brand hover:underline">wallet page</Link> shows
              a deposit address. Send SOL to it from any exchange or wallet. Solana network only —
              anything sent from another chain is unrecoverable.
            </Step>
            <Step n="03" title="Buy a basket">
              Pick one from <Link href="/baskets" className="text-brand hover:underline">Baskets</Link>{" "}
              or <Link href="/baskets/new" className="text-brand hover:underline">build your own</Link>,
              enter an amount in SOL, set exit rules if you want them, confirm. That&apos;s it.
            </Step>
          </div>
          <p className="text-[12.5px] text-ink3">
            Minimum buy is 0.01 SOL. A small amount stays in your wallet for network fees so your
            account can never brick itself.
          </p>
        </Section>

        <Section id="baskets" eyebrow="COIN BASKETS" title="Coin baskets">
          <p>
            <strong className="text-ink">Any Solana token can go in a basket</strong> — not just a
            curated list. The builder gives you four ways to find one: our curated pump.fun
            graduates, whatever&apos;s trending on Jupiter right now, the highest organic-score
            tokens (least botted volume), and the newest listings. You can also paste any mint
            address directly.
          </p>
          <p>
            The one hard requirement: the token must have a live price. A token nobody can price
            can&apos;t be bought or valued, so the builder refuses it rather than selling you a
            basket that can never trade.
          </p>
          <p>
            <strong className="text-ink">Weights</strong> must add to 100%. When you invest 1 SOL in
            a basket weighted 40/30/30, Basket spends 0.4, 0.3 and 0.3 SOL on those three tokens.
          </p>
          <p>
            <strong className="text-ink">Selling</strong> works the same way in reverse: pick a
            percentage, and each leg is swapped back to SOL in your wallet. If one token has gone
            completely illiquid, Basket tells you which one and offers to sell everything else and
            write that leg off — so one dead coin can never trap the rest of your position.
          </p>
        </Section>

        <Section id="traders" eyebrow="TRADER BASKETS" title="Trader baskets (copy-trading)">
          <p>
            Basket tracks <strong className="text-ink">563 real KOL wallets</strong>, publicly
            attributed via Kolscan. A trader basket groups several of them and follows their combined
            on-chain value as a NAV — real balances, real tokens, updated from the chain.
          </p>
          <p>
            <strong className="text-ink">Investing in one mirrors the squad.</strong> Your own wallet
            buys what those wallets currently hold, weighted by member and by position size. You
            hold the tokens directly — nothing is pooled into a fund, and there are no units to
            redeem. As the squad rotates, so does what a new investment buys.
          </p>
          <p className="rounded-lg border border-hairline bg-card2 p-3 text-[12.5px] leading-relaxed">
            <strong className="text-ink">Two honest limits.</strong> First, positions are read from
            wallet snapshots taken every few minutes, so a mirror can lag a KOL&apos;s entry — on a
            fast memecoin that lag is material, and it is shown on the basket rather than hidden.
            Second, mirroring copies their <em>cash</em> too: if the squad is 60% in SOL, only 60%
            of your deposit buys tokens. If they are almost entirely in cash, the app refuses the
            trade instead of putting your whole deposit into the sliver they still hold.
          </p>
        </Section>

        <Section id="exit-rules" eyebrow="AUTOMATION" title="Exit rules">
          <p>
            Memecoins don&apos;t wait for you to wake up. Every position can carry three rules:
          </p>
          <ul className="space-y-1.5 pl-1">
            <li>🎯 <strong className="text-ink">Take profit</strong> — sell everything once the position is up X%.</li>
            <li>🛡 <strong className="text-ink">Stop loss</strong> — sell everything once it&apos;s down X%.</li>
            <li>⌛ <strong className="text-ink">Auto-close</strong> — sell everything after N days, win or lose.</li>
          </ul>
          <p>
            A background engine checks every armed rule <strong className="text-ink">once a
            minute</strong> against live prices. When one triggers, it executes a real on-chain sell
            of the whole position and pings your Telegram if you&apos;ve linked it.
          </p>
          <p className="rounded-lg border border-hairline bg-card2 p-3 text-[12.5px] leading-relaxed">
            <strong className="text-ink">Two failure modes we handle explicitly.</strong> If the
            price feed goes down entirely, rules do <em>not</em> fire — an outage must never dump
            your position at a made-up valuation. But if one specific token dies while the others
            still price, that leg counts as worthless and the exit proceeds, selling everything that
            can still be sold. A stop-loss that silently never fires is worse than no stop-loss.
          </p>
          <p>
            Adding to a position never disarms rules you already set, and you can edit them any time
            without buying more.
          </p>
        </Section>

        <Section id="fees" eyebrow="COSTS" title="Fees, in full">
          <div className="card overflow-hidden">
            {[
              ["Swap fee", "0.5% per swap, both directions", "Charged by the router on each leg when you buy and when you sell."],
              ["Performance fee", `${PERFORMANCE_FEE_BPS / 100}% of realised profit`, "Only on gains, only when you sell. Never on your principal, never on a losing trade."],
              ["Basket creation", `${CREATION_FEE_SOL} SOL, once`, "Paid on-chain when you publish a basket. 100% goes to buyback & burn."],
              ["Deposits & withdrawals", "Free", "You pay only the Solana network fee (a fraction of a cent)."],
              ["Holding", "Free", "No management fee, no subscription, no monthly anything."],
            ].map(([name, amount, detail]) => (
              <div key={name} className="border-b border-hairline p-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{name}</span>
                  <span className="num text-[13px] text-brand">{amount}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink3">{detail}</p>
              </div>
            ))}
          </div>
          <p>
            Every fee is itemised on the{" "}
            <Link href="/treasury" className="text-brand hover:underline">public treasury ledger</Link>{" "}
            with the transaction signature that settled it, and all of it is earmarked for{" "}
            <Link href="/tokenomics" className="text-brand hover:underline">buyback &amp; burn</Link>.
          </p>
        </Section>

        <Section id="custody" eyebrow="SECURITY" title="Your wallet & keys">
          <p>
            Your account wallet is generated on our server and its private key is encrypted at rest
            with AES-256-GCM. This is a <strong className="text-ink">custodial</strong> design: it
            means no browser extension and no seed phrase, but it also means you are trusting this
            service with the key. That trade-off is stated plainly rather than buried.
          </p>
          <p>
            <strong className="text-ink">What that means practically:</strong> you can withdraw your
            SOL to any address at any time, and your tokens sit in a wallet whose address you can
            inspect on Solscan. Only you (through your login) can move funds — the API never returns
            your key, never logs it, and the Telegram bot has no access to it at all.
          </p>
          <p className="rounded-lg border border-hairline bg-card2 p-3 text-[12.5px]">
            Don&apos;t keep more in the account wallet than you&apos;re actively trading. Withdraw
            profits to a wallet you control the keys for. That is good practice with any custodial
            service, including this one.
          </p>
        </Section>

        <Section id="bot" eyebrow="TELEGRAM" title="Telegram bot">
          <p>
            Link your account from the{" "}
            <Link href="/wallet" className="text-brand hover:underline">wallet page</Link> and the bot
            reports your positions, P&amp;L, armed rules, wallet balance and the KOL leaderboard —
            and pushes an alert the moment a take-profit, stop-loss or timed exit fires.
          </p>
          <p className="rounded-lg border border-hairline bg-card2 p-3 text-[12.5px] leading-relaxed">
            <strong className="text-ink">The bot is read-only, deliberately.</strong> It cannot buy,
            sell, withdraw or touch your key. If someone ever compromised your Telegram, the worst
            they could do is read your portfolio. Trading stays on the site behind your login.
          </p>
          <p className="text-[12.5px] text-ink3">
            Linking uses a single-use code that expires in 15 minutes, so knowing your Telegram
            handle is never enough to reach your account.
          </p>
        </Section>

        <Section id="risks" eyebrow="RISK" title="Risks — read this">
          <ul className="space-y-2 pl-1">
            <li>
              <strong className="text-ink">Most memecoins go to zero.</strong> A basket spreads risk
              across tokens, but it does not remove it. Ten coins from the same trench can all fall
              together, and often do.
            </li>
            <li>
              <strong className="text-ink">Diversification within one asset class is thin
              protection.</strong> Memecoins are highly correlated. Treat a basket as a bet on a
              theme, not as a hedge.
            </li>
            <li>
              <strong className="text-ink">Liquidity can vanish.</strong> A token can become
              impossible to sell at any price. Exit rules cannot rescue a leg with no buyers.
            </li>
            <li>
              <strong className="text-ink">Slippage and price impact are real</strong>, especially on
              small-cap tokens and larger orders. What you get is what the market gives.
            </li>
            <li>
              <strong className="text-ink">This is a custodial service</strong> — see the section
              above.
            </li>
            <li>
              <strong className="text-ink">Nothing here is financial advice.</strong> Only trade what
              you can afford to lose entirely.
            </li>
          </ul>
        </Section>

        <Section id="faq" eyebrow="FAQ" title="Questions people actually ask">
          <div className="space-y-4">
            {[
              ["Do I own the tokens, or a share of a fund?", "You own the tokens, directly, in your own wallet. There is no fund and no pooling. The app tracks which tokens belong to which basket so it can show P&L and run your exit rules."],
              ["Can I put any coin in a basket?", "Yes — any Solana token with a live price, including brand-new pump.fun launches. Search by ticker or paste a mint address."],
              ["What happens if one coin in my basket rugs?", "The rest is unaffected. When you sell, Basket tells you which leg can't be routed and offers to sell everything else and write that one off at zero."],
              ["Why did my buy only partially fill?", "Each leg is a separate swap. If one fails (no route, slippage, network), the legs that already executed are yours and are recorded exactly — you'll see precisely how much was spent. Nothing is double-bought if you retry."],
              ["Is my stop-loss guaranteed?", "No. It fires within about a minute of the threshold being crossed at live prices, then executes a market sell. In a fast crash you may exit lower than your trigger. Nobody can guarantee a fill price on-chain."],
              ["Can the Telegram bot trade for me?", "No, by design. It reads and alerts. Trading requires your login on the site."],
              ["What does it cost to hold?", "Nothing. No management fee, no subscription. Fees are only on swaps and realised profit."],
              ["Can I withdraw any time?", "Yes. Sell to SOL and withdraw to any Solana address, whenever you want. There are no locks or notice periods."],
            ].map(([q, a]) => (
              <div key={q} className="card p-4">
                <div className="text-[13.5px] font-semibold text-ink">{q}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">{a}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="mt-12 flex flex-wrap gap-3 border-t border-hairline pt-8">
        <Link href="/baskets" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          Browse baskets
        </Link>
        <Link href="/tokenomics" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Tokenomics
        </Link>
        <Link href="/treasury" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Treasury ledger
        </Link>
      </div>
    </div>
  );
}
