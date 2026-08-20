/**
 * The hero's physical object: a glowing basket disc inside a rotating ring.
 *
 * Text and rotation are deliberately SEPARATED. Wrapping a wordmark around a
 * spinning circle guarantees it reads upside-down for half of every turn —
 * there is no path direction that avoids it. So the wordmark sits static on
 * the top arc where it always reads, and the motion lives in a geometric tick
 * ring that has no orientation to get wrong.
 */
export function SpinRing({ size = 300 }: { size?: number }) {
  const TICKS = 72;
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const angle = (i / TICKS) * Math.PI * 2;
    // every 6th tick is a long accent — gives the rotation a readable rhythm
    const long = i % 6 === 0;
    const r1 = long ? 104 : 112;
    const r2 = 120;
    return {
      x1: 150 + Math.cos(angle) * r1,
      y1: 150 + Math.sin(angle) * r1,
      x2: 150 + Math.cos(angle) * r2,
      y2: 150 + Math.sin(angle) * r2,
      w: long ? 2 : 1,
      o: long ? 0.75 : 0.3,
    };
  });

  return (
    <div className="relative select-none" style={{ width: size, height: size }} aria-hidden>
      {/* glow bed */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(61,125,255,0.28) 0%, rgba(61,125,255,0.08) 45%, transparent 70%)",
        }}
      />

      {/* rotating tick ring — the motion */}
      <svg viewBox="0 0 300 300" className="ring-spin absolute inset-0 h-full w-full">
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="var(--brand)"
            strokeOpacity={t.o}
            strokeWidth={t.w}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {/* static wordmark on the top arc — always upright, always readable */}
      <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full">
        <defs>
          {/* left→right over the top of the circle */}
          <path id="ringArcTop" d="M 22,150 A 128,128 0 0 1 278,150" fill="none" />
        </defs>
        <text
          fontSize="15"
          fill="var(--brand)"
          opacity="0.95"
          style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "3px" }}
        >
          <textPath href="#ringArcTop" startOffset="50%" textAnchor="middle">
            BUY THE WHOLE TRENCH
          </textPath>
        </text>
      </svg>

      {/* the disc mark */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/disc.svg"
        alt=""
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: size * 0.46,
          height: size * 0.46,
          filter: "drop-shadow(0 0 28px rgba(61,125,255,0.55))",
        }}
      />

      {/* thin orbit line */}
      <div className="absolute inset-[14%] rounded-full border border-brand/25" />
    </div>
  );
}
