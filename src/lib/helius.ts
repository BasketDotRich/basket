// Helius DAS wallet reader — the primary wallet-valuation source when
// HELIUS_RPC_URL is configured. One getAssetsByOwner call returns every
// fungible position WITH its USD price (token_info.price_info), plus the
// native SOL balance and its USD value. Spam tokens carry no price_info
// and drop out naturally. Falls back to the Jupiter method in wallets.ts
// when the env var is absent or the call fails.

export type HeliusHolding = {
  mint: string;
  symbol: string;
  amount: number;
  valueUsd: number;
};

export type HeliusWallet = {
  totalUsd: number;
  solAmount: number;
  solUsd: number;
  holdings: HeliusHolding[]; // priced fungibles, sorted by value desc
};

export function heliusConfigured(): boolean {
  return !!process.env.HELIUS_RPC_URL;
}

export async function getWalletViaHelius(wallet: string): Promise<HeliusWallet | null> {
  const url = process.env.HELIUS_RPC_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "basket-wallet",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: wallet,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
            showZeroBalance: false,
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`helius ${res.status}`);
    const data = (await res.json()) as {
      result?: {
        items?: Array<{
          id: string;
          interface?: string;
          token_info?: {
            symbol?: string;
            balance?: number;
            decimals?: number;
            price_info?: { price_per_token?: number; total_price?: number };
          };
        }>;
        nativeBalance?: { lamports?: number; price_per_sol?: number; total_price?: number };
      };
      error?: { message?: string };
    };
    if (data.error || !data.result) throw new Error(data.error?.message ?? "no result");

    const native = data.result.nativeBalance;
    const solAmount = (native?.lamports ?? 0) / 1e9;
    const solUsd = native?.total_price ?? 0;

    const holdings: HeliusHolding[] = [];
    for (const item of data.result.items ?? []) {
      const info = item.token_info;
      const priced = info?.price_info?.total_price;
      if (!info || !priced || priced < 1) continue; // unpriced/spam/dust
      const decimals = info.decimals ?? 0;
      holdings.push({
        mint: item.id,
        symbol: info.symbol || `${item.id.slice(0, 4)}…`,
        amount: (info.balance ?? 0) / Math.pow(10, decimals),
        valueUsd: priced,
      });
    }
    holdings.sort((a, b) => b.valueUsd - a.valueUsd);

    const totalUsd = solUsd + holdings.reduce((s, h) => s + h.valueUsd, 0);
    if (!(totalUsd >= 0) || (solUsd === 0 && solAmount > 0.01)) {
      // price data missing from the response — don't record a bogus value
      return null;
    }
    return { totalUsd, solAmount, solUsd, holdings };
  } catch {
    return null;
  }
}
