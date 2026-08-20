import Link from "next/link";
import { getUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";
import { MobileNav } from "./MobileNav";

const LINKS = [
  { href: "/", label: "Markets" },
  { href: "/baskets", label: "Baskets" },
  { href: "/dashboard", label: "Portfolio" },
  { href: "/wallet", label: "Wallet" },
  { href: "/treasury", label: "Treasury" },
  { href: "/docs", label: "Docs" },
];

export async function Nav() {
  const user = await getUser();
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-page/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-5 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-mono text-[15px] font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.svg" alt="" width={20} height={20} className="h-5 w-5" />
          BASKET<span className="font-normal text-ink3">.RICH</span>
        </Link>
        <nav className="hidden items-center gap-5 text-[13px] text-ink2 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          {user ? (
            <>
              <Link
                href="/wallet"
                className="num rounded-lg border border-hairline bg-card px-3 py-1 text-[13px] text-ink2 hover:text-ink"
                title="Your wallet"
              >
                Wallet
              </Link>
              <Link
                href="/baskets/new"
                className="btn-brand hidden rounded-lg px-3.5 py-1.5 text-[13px] font-medium sm:block"
              >
                + Basket
              </Link>
              <span className="hidden text-[13px] text-ink3 lg:inline">@{user.username}</span>
              <span className="hidden md:block">
                <LogoutButton />
              </span>
            </>
          ) : (
            <>
              <Link href="/login" className="text-[13px] text-ink2 hover:text-ink">
                Sign in
              </Link>
              <Link
                href="/register"
                className="btn-brand rounded-lg px-4 py-1.5 text-[13px] font-medium"
              >
                Get started
              </Link>
            </>
          )}
          <MobileNav links={LINKS} signedIn={user != null} username={user?.username ?? null} />
        </div>
      </div>
    </header>
  );
}
