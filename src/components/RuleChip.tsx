"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type RuleData = { tp_pct: number | null; sl_pct: number | null; close_at: number | null };

export function RuleChip({ basketId, rule }: { basketId: number; rule: RuleData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const parts: string[] = [];
  if (rule.tp_pct != null) parts.push(`TP +${rule.tp_pct}%`);
  if (rule.sl_pct != null) parts.push(`SL −${rule.sl_pct}%`);
  if (rule.close_at != null) {
    const days = Math.max(0, Math.ceil((rule.close_at - Date.now()) / 86_400_000));
    parts.push(`closes in ${days}d`);
  }
  if (parts.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="chip chip-on">{parts.join(" · ")}</span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            const res = await fetch(`/api/baskets/${basketId}/rules`, { method: "DELETE" });
            if (!res.ok) throw new Error(String(res.status));
            router.refresh();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
        className="text-[10px] text-ink3 hover:text-bad"
        title={failed ? "Couldn't disarm — click to retry" : "Disarm exit rules"}
      >
        {busy ? "…" : failed ? "retry ✕" : "✕"}
      </button>
    </span>
  );
}
