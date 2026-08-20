<p align="center">
  <img src="public/brand/banner-1500x500.png" alt="basket.rich" width="100%" />
</p>

# Basket

**Index baskets for the pump.fun trenches.** Weighted baskets of real Solana memecoins — and squads of the KOL wallets that actually trade them. One position, one thesis, exit rules that fire without you watching.

- **Coin baskets** — bundle any Solana tokens (curated pump.fun graduates, whatever's trending on Jupiter, or paste any mint) into a weighted index. Live-priced via Jupiter.
- **Trader baskets** — bundle real KOL wallets (563 tracked, attributed via Kolscan) and track their combined on-chain performance as a NAV.
- **Exit rules** — take-profit, stop-loss, and auto-close timers checked every minute against live prices; positions auto-redeem.
- **Account wallets** — every account gets its own Solana wallet at signup (AES-256-GCM encrypted at rest). Deposit SOL, withdraw any time.
- **Tokenomics** — 10% fee on realised profit only + 0.5 SOL basket-creation fee → treasury → deployed into top baskets → profits queued for buyback & burn.

## Stack

Next.js 16 (App Router) · React 19 · `node:sqlite` · Tailwind v4

Market data, all keyless-capable: Jupiter lite-api (prices, search, swaps, wallet balances) · DexScreener (pair stats) · CoinGecko (history) · GeckoTerminal (OHLCV candles).

## Run it

```bash
npm install
cp .env.example .env.local   # fill in ENCRYPTION_KEY at minimum
npm run dev
```

Then open [http://localhost:3000/setup](http://localhost:3000/setup) (sign in first) to see what's connected and what's left.

## Deployment note

The app uses a local SQLite database and in-process background jobs (price refresher, exit-rules engine), so it needs a host with a **persistent filesystem and a long-lived process** — a VPS, Railway, Fly.io, or Render with a volume. Serverless platforms (Vercel/Netlify functions) will not persist the database.

## Honesty rules

Everything rendered is real: real coins, real prices, real named wallets with public attribution, real on-chain tracking. The practice balance is the one explicitly-labeled sandbox. No fabricated history, no simulated fills.
