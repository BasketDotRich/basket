import type { ReactNode } from "react";

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="th">{label}</div>
      <div className="num mt-1.5 text-[26px] leading-8 font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-sm">{sub}</div> : null}
    </div>
  );
}
