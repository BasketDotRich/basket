"use client";

import { useCallback, useEffect, useState } from "react";
import { cls } from "@/lib/format";

type Status = {
  configured: boolean;
  botUsername: string | null;
  linked: { username: string | null; linkedAt: number; alertsOn: boolean } | null;
};

/**
 * One-tap Telegram linking. The code is minted server-side for the signed-in
 * account and is single-use — so the bot can prove who a chat belongs to
 * without ever handling a password.
 */
export function TelegramLink() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState<{ code: string; deepLink: string | null; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetch("/api/telegram/link", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setMsg(d.error ?? "Could not generate a code");
        return;
      }
      setCode(d);
    } catch {
      setMsg("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await fetch("/api/telegram/link", { method: "DELETE" });
      setCode(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="card p-5">
        <div className="skeleton h-4 w-36" />
        <div className="skeleton mt-3 h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Telegram</span>
        {status.linked ? (
          <span className="chip" style={{ color: "var(--good)", borderColor: "rgba(34,197,94,0.4)" }}>
            CONNECTED
          </span>
        ) : (
          <span className="chip">NOT CONNECTED</span>
        )}
        <span className="ml-auto text-[11px] text-ink3">read-only · never moves funds</span>
      </div>

      {!status.configured ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink3">
          The bot isn&apos;t configured on this deployment yet.
        </p>
      ) : status.linked ? (
        <>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink2">
            Linked{status.linked.username ? ` to @${status.linked.username}` : ""}. You&apos;ll get a
            ping when an exit rule fires or a buy fills. Send <code className="chip">/portfolio</code>{" "}
            in the chat any time.
          </p>
          <div className="mt-3 flex gap-2">
            {status.botUsername && (
              <a
                href={`https://t.me/${status.botUsername}`}
                target="_blank"
                rel="noreferrer"
                className="btn-brand rounded-lg px-4 py-2 text-[13px]"
              >
                Open chat ↗
              </a>
            )}
            <button
              onClick={unlink}
              disabled={busy}
              className="btn-ghost rounded-lg px-4 py-2 text-[13px]"
            >
              {busy ? "…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink2">
            Track your positions, P&amp;L and exit rules from Telegram — and get pinged the moment a
            stop-loss or take-profit fires.
          </p>
          {!code ? (
            <button
              onClick={generate}
              disabled={busy}
              className="btn-brand mt-3 rounded-lg px-4 py-2 text-[13px]"
            >
              {busy ? "Generating…" : "Connect Telegram"}
            </button>
          ) : (
            <div className="mt-3 space-y-2.5">
              {code.deepLink ? (
                <a
                  href={code.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-brand block rounded-lg px-4 py-2.5 text-center text-[13px]"
                >
                  Open Telegram &amp; link automatically ↗
                </a>
              ) : null}
              <div className="rounded-lg border border-hairline bg-card2 p-3">
                <div className="th">Or send this to the bot</div>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`/start ${code.code}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  className="num mt-1.5 flex w-full items-center justify-between gap-2 text-left text-[15px] text-ink"
                >
                  <span>/start {code.code}</span>
                  <span className={cls("text-[11px]", copied ? "text-good" : "text-ink3")}>
                    {copied ? "copied" : "copy"}
                  </span>
                </button>
              </div>
              <p className="text-[11px] text-ink3">
                Single-use, expires in 15 minutes. Anyone with this code could read your positions
                — don&apos;t share it.
              </p>
            </div>
          )}
        </>
      )}

      {msg && (
        <p role="status" className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">
          {msg}
        </p>
      )}
    </div>
  );
}
