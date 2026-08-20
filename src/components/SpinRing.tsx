/**
 * Rotating circular wordmark around the basket disc — the hero's physical
 * object. Pure SVG + CSS animation, server-rendered, honors reduced motion.
 */
export function SpinRing({ size = 300 }: { size?: number }) {
  const text = "BUY THE WHOLE TRENCH • BASKET.RICH • REAL ON-CHAIN SWAPS • ";
  return (
    <div
      className="relative select-none"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* glow bed */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(61,125,255,0.28) 0%, rgba(61,125,255,0.08) 45%, transparent 70%)",
        }}
      />
      {/* the disc mark */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/disc.svg"
        alt=""
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: size * 0.46, height: size * 0.46, filter: "drop-shadow(0 0 28px rgba(61,125,255,0.55))" }}
      />
      {/* rotating ring text */}
      <svg viewBox="0 0 300 300" className="ring-spin absolute inset-0 h-full w-full">
        <defs>
          <path
            id="ringPath"
            d="M 150,150 m -118,0 a 118,118 0 1,1 236,0 a 118,118 0 1,1 -236,0"
          />
        </defs>
        <text
          fontSize="16.4"
          fill="var(--brand)"
          opacity="0.9"
          style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "3.5px" }}
        >
          <textPath href="#ringPath">{text}</textPath>
        </text>
      </svg>
      {/* thin orbit line */}
      <div className="absolute inset-[8%] rounded-full border border-brand/25" />
    </div>
  );
}
