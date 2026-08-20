"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const OAUTH_ERRORS: Record<string, string> = {
  "google-unconfigured": "Google sign-in isn't configured yet — use email for now.",
  "google-state": "Google sign-in expired — try again.",
  "google-denied": "Google didn't confirm that account — try again or use email.",
};

export function AuthForm({
  mode,
  googleEnabled = false,
  oauthError,
}: {
  mode: "login" | "register";
  googleEnabled?: boolean;
  oauthError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthError ? (OAUTH_ERRORS[oauthError] ?? "Sign-in failed — try again.") : null
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "register" ? { email, username, password } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-hairline bg-card2 px-4 py-2.5 text-sm outline-none placeholder:text-ink3 focus:border-brand";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="card p-8">
        <h1 className="display text-[30px]">
          {mode === "register" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink3">
          {mode === "register"
            ? "You get your own Solana wallet the moment you sign up — deposit, trade baskets, withdraw whenever."
            : "Sign in to your Basket account."}
        </p>
        {/* Always visible: if the OAuth client isn't configured yet, the
            route bounces back here with ?error=google-unconfigured. */}
        <a
          href="/api/auth/google"
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-hairline bg-card2 py-3 text-sm font-medium text-ink transition hover:border-brand/60"
        >
          <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
            <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6z"/>
            <path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-3.7-13.6-9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>
          </svg>
          Continue with Google
        </a>
        {!googleEnabled && (
          <p className="mt-2 text-center text-[11px] text-ink3">
            Google sign-in needs an OAuth client —{" "}
            <Link href="/setup" className="text-brand hover:underline">
              two-minute setup
            </Link>
          </p>
        )}
        <div className="mt-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-ink3">
          <span className="h-px flex-1 bg-hairline" />
          or with email
          <span className="h-px flex-1 bg-hairline" />
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            className={inputCls}
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {mode === "register" && (
            <input
              className={inputCls}
              required
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          )}
          <input
            className={inputCls}
            type="password"
            required
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
          {error && <div className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">⚠ {error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="btn-brand w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
          >
            {busy ? "One sec…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-ink3">
          {mode === "register" ? (
            <>Already have an account? <Link className="text-brand hover:underline" href="/login">Sign in</Link></>
          ) : (
            <>New here? <Link className="text-brand hover:underline" href="/register">Create an account</Link></>
          )}
        </p>
      </div>
      <p className="mt-4 text-center text-xs text-ink3">
        Every account gets its own Solana wallet. Memecoins are extremely volatile — only trade
        what you can afford to lose.
      </p>
    </div>
  );
}
