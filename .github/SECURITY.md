# Security policy

Basket moves real funds on Solana mainnet. Please report vulnerabilities privately.

## Reporting

Do **not** open a public issue for a security bug. Use GitHub's private
[security advisory](https://github.com/BasketDotRich/basket/security/advisories/new)
form instead.

Please include what you can: affected endpoint or file, reproduction steps, and the
impact you believe it has.

## Scope — the things that matter most

- Anything that moves funds without the owner's authenticated action
- Any path that exposes `wallet_key`, a decrypted secret, or `ENCRYPTION_KEY`
- Auth bypass on a mutating route
- Anything that lets a basket, mirror or exit rule execute with attacker-controlled sizing

## Design notes for reviewers

- Account-wallet secrets are AES-256-GCM encrypted at rest and only ever decrypted inside
  `src/lib/custody.ts`. They are never logged and never returned by an API.
- The Telegram bot is deliberately read-only and has no access to keys.
- The Telegram and Helius webhooks both fail closed without their shared secret.
