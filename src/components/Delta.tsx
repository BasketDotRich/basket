import { cls, fmtPct } from "@/lib/format";

/** Signed change indicator — arrow glyph + sign, never color alone. */
export function Delta({
  value,
  className,
  suffix,
}: {
  value: number | null | undefined;
  className?: string;
  suffix?: string;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={cls("text-ink3", className)}>—</span>;
  }
  const up = value > 0.0001;
  const down = value < -0.0001;
  return (
    <span
      className={cls(
        "num",
        up ? "text-good" : down ? "text-bad" : "text-ink3",
        className
      )}
    >
      {up ? "▲ " : down ? "▼ " : "· "}
      {fmtPct(Math.abs(value), false)}
      {suffix ? <span className="text-ink3"> {suffix}</span> : null}
    </span>
  );
}
