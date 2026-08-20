/**
 * The perspective weave — the brand's signature surface.
 * Rows use 1/z spacing so they compress toward the horizon; columns converge on
 * the vanishing point. Alternating cells read as a woven basket floor.
 * Pure SVG, no client JS, renders on the server.
 */
export function WeaveFloor({
  width = 1600,
  height = 340,
  rows = 26,
  cols = 34,
  spread = 3.6,
  className,
}: {
  width?: number;
  height?: number;
  rows?: number;
  cols?: number;
  spread?: number;
  className?: string;
}) {
  const horizonY = 0;
  const vx = width / 2;
  const depth = height - horizonY;
  const yAt = (z: number) => horizonY + depth / z;
  const xAt = (i: number, z: number) => {
    const xBottom = vx + ((i - cols / 2) / (cols / 2)) * (width * spread) / 2;
    return vx + (xBottom - vx) / z;
  };

  const cells: { d: string; op: number }[] = [];
  for (let z = 1; z <= rows; z++) {
    const y0 = yAt(z);
    const y1 = yAt(z + 1);
    if (y0 - y1 < 0.35) break;
    for (let i = 0; i < cols; i++) {
      if ((i + z) % 2 !== 0) continue;
      cells.push({
        d: `M${xAt(i, z).toFixed(1)},${y0.toFixed(1)} L${xAt(i + 1, z).toFixed(1)},${y0.toFixed(1)} L${xAt(i + 1, z + 1).toFixed(1)},${y1.toFixed(1)} L${xAt(i, z + 1).toFixed(1)},${y1.toFixed(1)} Z`,
        op: Math.min(0.55, 0.09 + 0.5 / z),
      });
    }
  }

  const hLines: { y: number; x1: number; x2: number; op: number }[] = [];
  for (let z = 1; z <= rows + 1; z++) {
    const y = yAt(z);
    if (y < horizonY + 0.5) break;
    hLines.push({ y, x1: xAt(0, z), x2: xAt(cols, z), op: Math.min(0.6, 0.1 + 0.55 / z) });
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
      className={className}
    >
      {cells.map((c, i) => (
        <path key={i} d={c.d} fill="var(--brand)" opacity={c.op} />
      ))}
      {hLines.map((l, i) => (
        <line
          key={`h${i}`}
          x1={l.x1}
          y1={l.y}
          x2={l.x2}
          y2={l.y}
          stroke="#8fb8ff"
          strokeOpacity={l.op}
          strokeWidth={1}
        />
      ))}
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={xAt(i, 1)}
          y1={yAt(1)}
          x2={xAt(i, rows + 1)}
          y2={yAt(rows + 1)}
          stroke="#8fb8ff"
          strokeOpacity={0.22}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
