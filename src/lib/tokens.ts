// Curated pump.fun memecoin universe (24 tokens) — EVERY token here
// launched on pump.fun: verified by the vanity "pump" mint suffix or documented
// pre-suffix pump.fun provenance (MOODENG, GIGA, AURA). Indexed externals that
// merely appear on pump.fun's API (BONK, PENGU, TRUMP, WIF…) are excluded by
// design. Mints re-verified on Jupiter; launch dates from pump.fun's own API.
// Icons served from DexScreener's token-image CDN (reliable host).
export type CuratedToken = {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  coingeckoId: string | null;
  genres: string[];
  launchedAt: number | null; // pump.fun created_timestamp (ms)
};

export const GENRE_INFO: { name: string; description: string; source: string }[] = [
  { name: "AI Agents", description: "AI-born or AI-run tokens — Truth Terminal spawns, agent frameworks, autonomous creators.", source: "https://www.coingecko.com/en/categories/ai-meme-coins" },
  { name: "Dogs", description: "Dog-themed pump launches carrying the founding meme lineage.", source: "https://www.coingecko.com/en/categories/dog-themed-coins" },
  { name: "Zoo", description: "Real viral animals turned tickers — the pygmy hippo and the squirrel.", source: "https://www.coingecko.com/learn/what-is-moodeng-crypto-hippo-memecoin-solana" },
  { name: "Chan Culture", description: "Sigma memes, doomers and financial nihilism from chan culture.", source: "https://iq.wiki/wiki/spx6900-spx" },
  { name: "TikTok Viral", description: "TikTok and Gen-Z viral formats with mainstream reach.", source: "https://coinedition.com/meme-coin-promotion-shifts-to-tiktok-as-chillguy-goes-viral/" },
  { name: "Celebrity & IP", description: "Real people, artworks and brands — from Ansem's bull to the duct-taped banana.", source: "https://www.chaincatcher.com/en/article/2159892" },
  { name: "Parody", description: "Self-aware satire of crypto and TradFi itself.", source: "https://en.cryptonomist.ch/2025/03/04/spx6900-the-token-of-the-memecoin-that-parodies-the-sp500/" },
  { name: "2024 Class", description: "The pump.fun breakout class of 2024 — the era that built the launchpad.", source: "https://en.wikipedia.org/wiki/Pump.fun" },
  { name: "2025 Class", description: "2025 graduates that survived the launchpad flood.", source: "https://en.wikipedia.org/wiki/Pump.fun" },
  { name: "Fresh 2026", description: "This cycle's breakouts — young, liquid, fast-rotating.", source: "https://www.coingecko.com/en/coins/the-black-bull" },
];

export const PLAYSTYLES: { name: string; description: string; source: string }[] = [
  { name: "New-Pair Trenching", description: "Trades brand-new launches in their first minutes, riding violent early momentum for fast in-and-out.", source: "https://crypto.news/what-are-the-trenches-solana-memecoin-culture" },
  { name: "Catalyst Plays", description: "Event-driven entries around listings, unlocks, elections, and product launches — in ahead of the date, out on the news.", source: "https://www.kucoin.com/news/articles/crypto-market-braces-for-key-catalysts" },
  { name: "Narrative Frontrunning", description: "Buys an emerging theme before it trends and exits into the crowd once it does.", source: "https://www.sharpe.ai/learn/memecoin-narrative-tracker" },
  { name: "Majors Rotation", description: "Rotates through the large-cap graduates as sector momentum shifts.", source: "https://blockchain.news/flashnews/memecoin-rotation-alert" },
  { name: "Slow Cook", description: "Accumulates the deep-liquidity graduates and holds through cycles instead of scalping.", source: "https://www.mexc.com/en-GB/crypto-pulse/article/memecoin-price-strategies" },
  { name: "Revival Plays", description: "Targets left-for-dead coins showing renewed volume and holder growth, betting on a second pump.", source: "https://www.ccn.com/news/crypto/memecoins-comeback-2026" },
];

export const CURATED_TOKENS: CuratedToken[] = [
  {
    mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    symbol: "FARTCOIN",
    name: "Fartcoin",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump.png?size=lg",
    decimals: 6,
    coingeckoId: "fartcoin",
    genres: ["AI Agents","2024 Class"],
    launchedAt: 1729231506539,
  },
  {
    mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
    symbol: "PNUT",
    name: "Peanut the Squirrel",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump.png?size=lg",
    decimals: 6,
    coingeckoId: "peanut-the-squirrel",
    genres: ["Zoo","2024 Class"],
    launchedAt: 1730384501286,
  },
  {
    mint: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY",
    symbol: "MOODENG",
    name: "Moo Deng",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY.png?size=lg",
    decimals: 6,
    coingeckoId: "moo-deng",
    genres: ["Zoo","TikTok Viral","2024 Class"],
    launchedAt: 1725989128495,
  },
  {
    mint: "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9",
    symbol: "GIGA",
    name: "GIGACHAD",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9.png?size=lg",
    decimals: 5,
    coingeckoId: "gigachad-2",
    genres: ["Chan Culture","2024 Class"],
    launchedAt: 1704402888000,
  },
  {
    mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump",
    symbol: "GOAT",
    name: "Goatseus Maximus",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump.png?size=lg",
    decimals: 6,
    coingeckoId: "goatseus-maximus",
    genres: ["AI Agents","Chan Culture","2024 Class"],
    launchedAt: 1728594508154,
  },
  {
    mint: "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump",
    symbol: "CHILLGUY",
    name: "Just a chill guy",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump.png?size=lg",
    decimals: 6,
    coingeckoId: "chill-guy",
    genres: ["Dogs","TikTok Viral","2024 Class"],
    launchedAt: 1728174673742,
  },
  {
    mint: "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump",
    symbol: "ACT",
    name: "Act I : The AI Prophecy",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump.png?size=lg",
    decimals: 6,
    coingeckoId: "act-i-the-ai-prophecy",
    genres: ["AI Agents","2024 Class"],
    launchedAt: 1729337230871,
  },
  {
    mint: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump",
    symbol: "ANSEM",
    name: "The Black Bull",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump.png?size=lg",
    decimals: 6,
    coingeckoId: "the-black-bull",
    genres: ["Celebrity & IP","Fresh 2026"],
    launchedAt: 1781643948000,
  },
  {
    mint: "9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump",
    symbol: "BAN",
    name: "Comedian",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump.png?size=lg",
    decimals: 6,
    coingeckoId: "comedian",
    genres: ["Celebrity & IP","2024 Class"],
    launchedAt: 1729865058694,
  },
  {
    mint: "Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump",
    symbol: "NEET",
    name: "NotInEmploymentEducationTraining",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump.png?size=lg",
    decimals: 6,
    coingeckoId: "neet",
    genres: ["Chan Culture","2025 Class"],
    launchedAt: 1745713920819,
  },
  {
    mint: "Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump",
    symbol: "PIPPIN",
    name: "Pippin",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump.png?size=lg",
    decimals: 6,
    coingeckoId: "pippin",
    genres: ["AI Agents","2024 Class"],
    launchedAt: 1731183096749,
  },
  {
    mint: "DtR4D9FtVoTX2569gaL837ZgrB6wNjj6tkmnX9Rdk9B2",
    symbol: "AURA",
    name: "aura",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/DtR4D9FtVoTX2569gaL837ZgrB6wNjj6tkmnX9Rdk9B2.png?size=lg",
    decimals: 6,
    coingeckoId: "aura-on-sol",
    genres: ["TikTok Viral","2024 Class"],
    launchedAt: 1717098849372,
  },
  {
    mint: "y1AZt42vceCmStjW4zetK3VoNarC1VxJ5iDjpiupump",
    symbol: "FARTBOY",
    name: "FARTBOY",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/y1AZt42vceCmStjW4zetK3VoNarC1VxJ5iDjpiupump.png?size=lg",
    decimals: 9,
    coingeckoId: "fartboy",
    genres: ["AI Agents","2025 Class"],
    launchedAt: 1736105803000,
  },
  {
    mint: "HgBRWfYxEfvPhtqkaeymCQtHCrKE46qQ43pKe8HCpump",
    symbol: "BERT",
    name: "Bertram The Pomeranian",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/HgBRWfYxEfvPhtqkaeymCQtHCrKE46qQ43pKe8HCpump.png?size=lg",
    decimals: 6,
    coingeckoId: "bertram-the-pomeranian",
    genres: ["Dogs","2024 Class"],
    launchedAt: 1727735802382,
  },
  {
    mint: "Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump",
    symbol: "BUTTCOIN",
    name: "Buttcoin",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump.png?size=lg",
    decimals: 6,
    coingeckoId: "buttcoin-7",
    genres: ["Parody","Fresh 2026"],
    launchedAt: 1767964561000,
  },
  {
    mint: "BCdwQBAn8dYB5YjTsoB6TdHAWokxv28k2oZUodERpump",
    symbol: "MANIFEST",
    name: "Manifesting",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/BCdwQBAn8dYB5YjTsoB6TdHAWokxv28k2oZUodERpump.png?size=lg",
    decimals: 6,
    coingeckoId: "manifesting",
    genres: ["Fresh 2026"],
    launchedAt: 1778686350000,
  },
  {
    mint: "eL5fUxj2J4CiQsmW85k5FG9DvuQjjUoBHoQBi2Kpump",
    symbol: "UFD",
    name: "Unicorn Fart Dust",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/eL5fUxj2J4CiQsmW85k5FG9DvuQjjUoBHoQBi2Kpump.png?size=lg",
    decimals: 6,
    coingeckoId: "unicorn-fart-dust",
    genres: ["Celebrity & IP","2024 Class"],
    launchedAt: 1734399716200,
  },
  {
    mint: "6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump",
    symbol: "VINE",
    name: "Vine Coin",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump.png?size=lg",
    decimals: 6,
    coingeckoId: "vine",
    genres: ["Celebrity & IP","2025 Class"],
    launchedAt: 1737591433339,
  },
  {
    mint: "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump",
    symbol: "ARC",
    name: "AI Rig Complex",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump.png?size=lg",
    decimals: 6,
    coingeckoId: "ai-rig-complex",
    genres: ["AI Agents","2024 Class"],
    launchedAt: 1733864953486,
  },
  {
    mint: "FeR8VBqNRSUD5NtXAj2n3j1dAHkZHfyDktKuLXD4pump",
    symbol: "JELLYJELLY",
    name: "jelly-my-jelly",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/FeR8VBqNRSUD5NtXAj2n3j1dAHkZHfyDktKuLXD4pump.png?size=lg",
    decimals: 6,
    coingeckoId: "jelly-my-jelly",
    genres: ["Celebrity & IP","2025 Class"],
    launchedAt: 1738193364571,
  },
  {
    mint: "HmjCoarLh5duURfJ333DwfFiPyTCgFT35pRSAoP8pump",
    symbol: "TOS",
    name: "TokenOS AI",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/HmjCoarLh5duURfJ333DwfFiPyTCgFT35pRSAoP8pump.png?size=lg",
    decimals: 6,
    coingeckoId: "tokenos-ai",
    genres: ["2025 Class"],
    launchedAt: 1748051194850,
  },
  {
    mint: "UWUy7J86LUiBv5SjAUZ53LMGhtnqvbQ7QNSSkyupump",
    symbol: "UWU",
    name: "Unicorn",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/UWUy7J86LUiBv5SjAUZ53LMGhtnqvbQ7QNSSkyupump.png?size=lg",
    decimals: 6,
    coingeckoId: "unicorn-3-2",
    genres: ["Fresh 2026"],
    launchedAt: 1779473739000,
  },
  {
    mint: "HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump",
    symbol: "ALCH",
    name: "Alchemist AI",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump.png?size=lg",
    decimals: 6,
    coingeckoId: "alchemist-ai",
    genres: ["AI Agents","2024 Class"],
    launchedAt: 1732730008152,
  },
  {
    mint: "DKu9kykSfbN5LBfFXtNNDPaX35o4Fv6vJ9FKk7pZpump",
    symbol: "AVA",
    name: "Ava AI",
    icon: "https://dd.dexscreener.com/ds-data/tokens/solana/DKu9kykSfbN5LBfFXtNNDPaX35o4Fv6vJ9FKk7pZpump.png?size=lg",
    decimals: 6,
    coingeckoId: "ava-ai",
    genres: ["AI Agents","2024 Class"],
    launchedAt: 1731523297743,
  },
];

export const TOKENS_BY_MINT: Record<string, CuratedToken> = Object.fromEntries(
  CURATED_TOKENS.map((t) => [t.mint, t])
);

export function isCurated(mint: string): boolean {
  return mint in TOKENS_BY_MINT;
}
