import Link from "next/link";
import { cls } from "@/lib/format";

export type OnboardingState = {
  invested: boolean;
  armedRule: boolean;
  createdBasket: boolean;
};

const STEPS: {
  key: keyof OnboardingState;
  title: string;
  body: string;
  cta: { href: string; label: string };
}[] = [
  {
    key: "invested",
    title: "Take your first position",
    body: "Pick a genre index — Pump Majors, AI Agents, Chan Culture — and invest. Your practice balance starts at $10,000.",
    cta: { href: "/baskets", label: "Browse baskets" },
  },
  {
    key: "armedRule",
    title: "Set an exit before you need it",
    body: "Arm a take-profit or stop-loss when you invest and it fires automatically, day or night.",
    cta: { href: "/baskets", label: "Invest with rules" },
  },
  {
    key: "createdBasket",
    title: "Build your own basket",
    body: "Any token Jupiter can route, or a squad of tracked KOL wallets. 0.5 SOL to create.",
    cta: { href: "/baskets/new", label: "Create a basket" },
  },
];

export function Onboarding({ state }: { state: OnboardingState }) {
  const done = STEPS.filter((s) => state[s.key]).length;
  if (done === STEPS.length) return null;
  const next = STEPS.find((s) => !state[s.key])!;

  return (
    <div className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="th">Getting started</span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-card2">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${(done / STEPS.length) * 100}%` }}
          />
        </div>
        <span className="num text-xs text-ink3">
          {done}/{STEPS.length}
        </span>
        <Link href={next.cta.href} className="btn-brand ml-auto rounded-md px-3.5 py-1.5 text-[13px] font-medium">
          {next.cta.label}
        </Link>
      </div>
      <ol className="grid gap-px bg-hairline sm:grid-cols-3">
        {STEPS.map((s, i) => {
          const complete = state[s.key];
          const isNext = s.key === next.key;
          return (
            <li
              key={s.key}
              className={cls("bg-card px-4 py-3", isNext && "bg-card2/60")}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cls(
                    "flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-semibold",
                    complete
                      ? "border-good bg-good/15 text-good"
                      : isNext
                        ? "border-brand text-brand"
                        : "border-hairline text-ink3"
                  )}
                >
                  {complete ? "✓" : i + 1}
                </span>
                <span className={cls("text-[13px] font-medium", complete ? "text-ink3 line-through" : "text-ink")}>
                  {s.title}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">{s.body}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
