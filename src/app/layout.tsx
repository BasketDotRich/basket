import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// display face — carries the brand voice on headlines
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://basket.rich"),
  title: "Basket — index baskets for the pump.fun trenches",
  description:
    "Weighted baskets of verified pump.fun memecoins and 563 tracked KOL wallets. Live Solana market data, on-chain wallet tracking, exit rules that fire for you.",
  openGraph: {
    title: "basket.rich",
    description:
      "Index baskets for the pump.fun trenches — live Solana data, 563 tracked KOL wallets.",
    images: ["/brand/banner-1500x500.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "basket.rich",
    description:
      "Index baskets for the pump.fun trenches — live Solana data, 563 tracked KOL wallets.",
    images: ["/brand/banner-1500x500.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-hairline py-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-xs leading-relaxed text-ink3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tracking-tight text-ink2">basket</span>
              <span className="text-ink3">·</span>
              <span>basket.rich</span>
              <span className="text-ink3">·</span>
              <a href="/docs" className="hover:text-ink2">docs</a>
              <span className="text-ink3">·</span>
              <a href="/tokenomics" className="hover:text-ink2">tokenomics</a>
              <span className="text-ink3">·</span>
              <a href="https://github.com/BasketDotRich" target="_blank" rel="noreferrer" className="hover:text-ink2">
                github
              </a>
            </div>
            <p>
              Every account gets its own Solana wallet — deposit, trade baskets, withdraw any
              time. Market data: Jupiter, DexScreener, CoinGecko. Wallet tracking is on-chain;
              trader wallets are publicly attributed via Kolscan. Every trade is a real
              on-chain swap — there is no simulated money anywhere on this site. Memecoins are
              extremely volatile and most go to zero — nothing here is investment advice.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
