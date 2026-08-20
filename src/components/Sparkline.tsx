/** Tiny inline trend chart for table rows. Pure SVG — renders on the server. */
export function Sparkline({
  data,
  width = 110,
  height = 32,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return <span className="text-xs text-ink3">—</span>;
  }
  // downsample to ~40 points so paths stay light
  const step = Math.max(1, Math.floor(data.length / 40));
  const pts = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 2;
  const coords = pts
    .map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  const color = up ? "var(--good)" : "var(--bad)";
  return (
    <svg width={width} height={height} aria-hidden className="block">
      <polyline
        points={coords}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}
