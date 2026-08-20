import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { custodyConfigured } from "@/lib/custody";
import { cls } from "@/lib/format";

export const dynamic = "force-dynamic";

// Operator page: integration status only — never renders a secret, only
// whether one is present. Sign-in required so it isn't world-readable.
export default async function SetupPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/setup");

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/google/callback";

  const checks = [
    {
      name: "Helius RPC",
      ok: !!process.env.HELIUS_RPC_URL,
      env: "HELIUS_RPC_URL",
      what: "Solana RPC for wallet reads and transaction sends.",
      how: "Paste a Helius (or any Solana) RPC URL into .env.local.",
      required: true,
    },
    {
      name: "CoinGecko",
      ok: !!process.env.COINGECKO_API_KEY,
      env: "COINGECKO_API_KEY",
      what: "7-day sparklines, index history, market caps.",
      how: "Optional API key for faster history. Works keyless too, just slower.",
      required: false,
    },
    {
      name: "Google sign-in",
      ok: googleEnabled(),
      env: "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET",
      what: "Lets people sign up with one click instead of email + password.",
      how: "Create an OAuth client (steps below), then paste both values into .env.local.",
      required: true,
    },
    {
      name: "Account wallets",
      ok: custodyConfigured(),
      env: "ENCRYPTION_KEY",
      what: "Every account gets its own Solana wallet at signup; the key encrypts wallet secrets at rest.",
      how: "Set once and back it up — rotating or losing it locks every account wallet permanently.",
      required: true,
    },
    {
      name: "Fee collection wallet",
      ok: !!process.env.TREASURY_WALLET,
      env: "TREASURY_WALLET",
      what: "Receives the 0.5 SOL basket-creation fee on-chain.",
      how: "Paste a Solana address you control into .env.local. Until then, creation fees aren't charged on-chain.",
      required: true,
    },
    {
      name: "Swap platform fee",
      ok: !!process.env.PLATFORM_FEE_ACCOUNT,
      env: "PLATFORM_FEE_ACCOUNT",
      what: `Takes ${process.env.PLATFORM_FEE_BPS ?? 50} bps on each swap, routed by Jupiter to your referral token account.`,
      how: "Create a Jupiter referral account, then paste the fee token account here.",
      required: false,
    },
  ];

  const googleOk = googleEnabled();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-[34px]">Setup</h1>
      <p className="mt-1 text-[13px] text-ink2">
        What&apos;s connected, and what&apos;s left. Values live in{" "}
        <code className="chip">moonbaskets/.env.local</code> — this page only ever shows whether a
        key is present, never the key itself.
      </p>

      <div className="mt-6 space-y-3">
        {checks.map((c) => (
          <div key={c.name} className="card p-4">
            <div className="flex items-center gap-2.5">
              <span
                className={cls(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                  c.ok ? "bg-good/15 text-good" : "bg-warn/15 text-warn"
                )}
              >
                {c.ok ? "✓" : "!"}
              </span>
              <span className="font-medium">{c.name}</span>
              <span className={cls("chip", c.ok ? "text-good" : "text-warn")}>
                {c.ok ? "CONNECTED" : "NOT SET"}
              </span>
              <code className="ml-auto hidden text-[11px] text-ink3 sm:block">{c.env}</code>
            </div>
            <p className="mt-1.5 text-[13px] text-ink2">{c.what}</p>
            <p className="mt-0.5 text-[12px] text-ink3">{c.how}</p>
          </div>
        ))}
      </div>

      {!googleOk && (
        <div className="card mt-6 p-5">
          <h2 className="text-[15px] font-semibold">Turn on Google sign-in</h2>
          <p className="mt-1 text-[13px] text-ink2">
            Takes about two minutes. The sign-in button appears automatically once both values are
            set — no code changes.
          </p>
          <ol className="mt-4 space-y-3 text-[13px] leading-relaxed text-ink2">
            <li>
              <span className="chip mr-1.5">1</span> Open{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                console.cloud.google.com/apis/credentials
              </a>{" "}
              and create a project if you don&apos;t have one.
            </li>
            <li>
              <span className="chip mr-1.5">2</span> Configure the OAuth consent screen: type{" "}
              <strong className="text-ink">External</strong>, app name{" "}
              <strong className="text-ink">Basket</strong>, and your email for support/developer
              contact. Save.
            </li>
            <li>
              <span className="chip mr-1.5">3</span> Credentials →{" "}
              <strong className="text-ink">Create credentials</strong> →{" "}
              <strong className="text-ink">OAuth client ID</strong> →{" "}
              <strong className="text-ink">Web application</strong>.
            </li>
            <li>
              <span className="chip mr-1.5">4</span> Under{" "}
              <strong className="text-ink">Authorised redirect URIs</strong>, add exactly this:
              <code className="mt-1.5 block overflow-x-auto rounded-md border border-hairline bg-card2 px-3 py-2 text-[12px] text-ink">
                {redirectUri}
              </code>
              <span className="text-ink3">
                When you deploy, add the production one too:{" "}
                <code className="text-ink2">https://basket.rich/api/auth/google/callback</code>
              </span>
            </li>
            <li>
              <span className="chip mr-1.5">5</span> Copy the client ID and secret into{" "}
              <code className="chip">moonbaskets/.env.local</code>:
              <code className="mt-1.5 block overflow-x-auto rounded-md border border-hairline bg-card2 px-3 py-2 text-[12px] leading-relaxed text-ink">
                GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
                <br />
                GOOGLE_CLIENT_SECRET=your-secret
              </code>
            </li>
            <li>
              <span className="chip mr-1.5">6</span> Restart the dev server and reload this page —
              the badge above turns green and the &ldquo;Continue with Google&rdquo; button on{" "}
              <Link href="/register" className="text-brand hover:underline">
                the sign-up page
              </Link>{" "}
              starts working.
            </li>
          </ol>
        </div>
      )}

      {googleOk && (
        <div className="card mt-6 p-5">
          <h2 className="text-[15px] font-semibold text-good">Google sign-in is live</h2>
          <p className="mt-1 text-[13px] text-ink2">
            Try it on the{" "}
            <Link href="/register" className="text-brand hover:underline">
              sign-up page
            </Link>
            . New Google accounts get a username derived from the email, their own Solana
            wallet, and the same $10,000 practice balance.
          </p>
        </div>
      )}
    </div>
  );
}
