"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cls } from "@/lib/format";

export function MobileNav({
  links,
  signedIn,
  username,
}: {
  links: { href: string; label: string }[];
  signedIn: boolean;
  username: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // close on navigation and on Escape
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-card text-ink2"
      >
        <span className="relative block h-3 w-4">
          <span
            className={cls(
              "absolute left-0 h-[1.5px] w-4 bg-current transition-all",
              open ? "top-1.5 rotate-45" : "top-0"
            )}
          />
          <span
            className={cls(
              "absolute left-0 top-1.5 h-[1.5px] w-4 bg-current transition-opacity",
              open && "opacity-0"
            )}
          />
          <span
            className={cls(
              "absolute left-0 h-[1.5px] w-4 bg-current transition-all",
              open ? "top-1.5 -rotate-45" : "top-3"
            )}
          />
        </span>
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-14 z-40 cursor-default bg-page/70 backdrop-blur-sm"
          />
          <nav className="fixed inset-x-0 top-14 z-50 border-b border-hairline bg-card p-3 shadow-2xl">
            <ul className="flex flex-col">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={cls(
                      "block rounded-lg px-3 py-2.5 text-[15px]",
                      pathname === l.href ? "bg-card2 text-ink" : "text-ink2"
                    )}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-hairline pt-2">
              {signedIn ? (
                <>
                  <Link
                    href="/baskets/new"
                    className="btn-brand block rounded-lg px-3 py-2.5 text-center text-[15px] font-medium"
                  >
                    Create a basket
                  </Link>
                  <div className="mt-2 flex items-center justify-between px-3 py-1 text-[13px] text-ink3">
                    <span>@{username}</span>
                    <button
                      onClick={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        setOpen(false);
                        router.push("/");
                        router.refresh();
                      }}
                      className="hover:text-bad"
                    >
                      Log out
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-2">
                  <Link
                    href="/login"
                    className="flex-1 rounded-lg border border-hairline px-3 py-2.5 text-center text-[15px] text-ink2"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    className="btn-brand flex-1 rounded-lg px-3 py-2.5 text-center text-[15px] font-medium"
                  >
                    Get started
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
