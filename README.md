<p align="center">
  <img src="public/brand/banner-1500x500.png" alt="Basket" width="100%" />
</p>

<p align="center">
  <a href="https://basket.rich"><strong>basket.rich</strong></a> ·
  <a href="https://basket.rich/docs">Docs</a> ·
  <a href="https://basket.rich/tokenomics">Tokenomics</a> ·
  <a href="https://t.me/BasketRich_Bot">Telegram bot</a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Solana" src="https://img.shields.io/badge/Solana-mainnet-14F195?logo=solana&logoColor=black">
</p>

# Basket

**Buying one memecoin is a coin flip. Buying ten is a thesis.**

Basket buys a weighted index of Solana memecoins in a single action, and lets you set the
exit before you need it. Every buy, sell and fee is a real on-chain transaction — there is
no paper trading and no simulated data anywhere in the product.

---

## What it does

### Coin baskets
Bundle **any** Solana token into a weighted index — the curated universe (67 tokens across
every cap tier), whatever is trending on Jupiter, the highest organic-score tokens, the
newest listings, or any mint address you paste.

Investing fires one real Jupiter swap per leg, sized to its weight. **The tokens land in
your own wallet.** Nothing is pooled, there are no fund units, and the app never holds your
tokens in an omnibus account — the `holdings` table is just a ledger of which tokens belong
to which thesis, so P&L, exit rules and redeems know what to act on.

### Trader baskets (copy-trading)
563 real KOL wallets, publicly attributed via Kolscan. Group several into a squad and your
wallet mirrors **what they actually hold right now**, weighted by member and position size.

Two details that make this honest rather than dangerous:

- **It copies their cash, too.** If the squad is 60% in SOL, only 60% of your deposit buys
  tokens. Deploying 100% into the sliver a mostly-cashed-out squad still holds would be a
  far larger bet than they are making, so below a 15% deployed threshold the trade is
  refused outright with the reason shown.
- **It refuses partial data.** If only some member wallets can be read, mirroring would
  weight the squad wrongly, so it declines instead of guessing.

Detection runs on Helius webhooks (near-instant) with a periodic balance sweep as a
self-correcting safety net.

### Exit rules
Take-profit, stop-loss and auto-close timers, checked every minute against live prices and
executed as real on-chain sells.

Two failure modes are handled explicitly: if the **price feed** is down, rules do *not*
fire — an outage must never dump a position at a made-up valuation. But if one specific
token dies while the others still price, that leg counts as worthless and the exit
proceeds, selling everything still sellable. A stop-loss that silently never fires is worse
than no stop-loss.

### Account wallets
Every account gets a Solana wallet at signup, its key encrypted at rest with AES-256-GCM.
No extension, no seed phrase. This is a **custodial** design and the docs say so plainly.

### Telegram bot
[@BasketRich_Bot](https://t.me/BasketRich_Bot) reports positions, P&L, armed rules and
wallet balance, and pushes an alert the moment an exit fires. **Read-only by design** — it
cannot buy, sell, withdraw or touch a key. Linking uses a single-use, 15-minute code minted
while signed in.

---

## Money-safety design

Handling real funds shaped most of the architecture:

| Concern | How it's handled |
|---|---|
| A swap that never lands | Every transaction is **confirmed**, not just accepted by the RPC |
| A leg failing mid-basket | Legs execute **one at a time**, each committed the moment it confirms — a later failure can't erase or duplicate an earlier one |
| Fees on unrealised gains | Performance fee settles **after** sells commit, on profit that actually realised |
| Paying for nothing | Basket + tokens insert atomically **before** the creation fee; the basket rolls back if the fee fails |
| An unpriceable token | Refused at creation — it could never be bought or valued |
| A brand-new listing's fake 24h % | Excluded from basket headlines and labelled `NEW` instead |
| An unhandled rejection killing the container | Process-level guards log with a stack instead of exiting |

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · `node:sqlite` · Tailwind v4

**Data**, all keyless-capable: Jupiter lite-api (prices, search, swap quotes, wallet
balances) · DexScreener (pair stats) · CoinGecko (history) · GeckoTerminal (OHLCV) ·
Helius (RPC + trade webhooks).

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the keys you have
npm run dev
```

Only `ENCRYPTION_KEY` is strictly required — it encrypts account-wallet secrets. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Back it up.** Rotating or losing `ENCRYPTION_KEY` permanently locks every account wallet.

Market data works without any API key; Helius, CoinGecko Pro, Google OAuth and the Telegram
bot each unlock more when configured. `/setup` shows what is connected and what is missing.

## Deployment

Runs on Railway with a persistent volume for SQLite (`DATA_DIR=/data`).

> Railway sets `PORT=8080` — the public domain's target port must match, or you get a
> permanent 502 while the deploy log cheerfully says "Ready".

---

## Disclaimer

Memecoins are extremely volatile and most go to zero. A basket spreads risk across tokens
but does not remove it — memecoins are highly correlated, so treat one as a bet on a theme,
not as a hedge. Nothing in this repository or product is investment advice.
