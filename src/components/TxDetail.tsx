/**
 * Render a ledger/activity detail string with any transaction signature turned
 * into a Solscan link.
 *
 * The whole claim of this app is that its numbers come from the chain. A
 * signature printed as inert text asks people to take that on trust; a link
 * lets them check it in one click, which is the difference between saying
 * "verifiable" and being verifiable.
 */
const SIG_RE = /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g;

export function TxDetail({ detail, className }: { detail: string; className?: string }) {
  const parts: (string | { sig: string })[] = [];
  let last = 0;
  for (const m of detail.matchAll(SIG_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(detail.slice(last, start));
    parts.push({ sig: m[0] });
    last = start + m[0].length;
  }
  if (last < detail.length) parts.push(detail.slice(last));

  return (
    <span className={className}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a
            key={i}
            href={`https://solscan.io/tx/${p.sig}`}
            target="_blank"
            rel="noreferrer"
            title={p.sig}
            className="num text-brand hover:underline"
          >
            {p.sig.slice(0, 6)}…{p.sig.slice(-4)} ↗
          </a>
        )
      )}
    </span>
  );
}
