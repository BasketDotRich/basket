import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="chip">404</div>
      <h1 className="display mt-4 text-[34px]">Nothing in this basket</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
        That page doesn&apos;t exist — it may have been a basket that was deleted, or a token that
        isn&apos;t tracked.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2.5">
        <Link href="/baskets" className="btn-brand rounded-xl px-5 py-2.5 text-sm">
          Browse baskets
        </Link>
        <Link href="/" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          Markets
        </Link>
        <Link href="/docs" className="btn-ghost rounded-xl px-5 py-2.5 text-sm">
          How it works
        </Link>
      </div>
    </div>
  );
}
