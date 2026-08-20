// Telegram command handlers. Read-only: these report on an account, they
// never move funds. Every number comes from the same functions the website
// renders, so the bot can never drift from the site.
import { getDb } from "./db";
import {
  SITE_URL,
  esc,
  getLinkByChat,
  money,
  pct,
  redeemLinkCode,
  sendMessage,
  setAlerts,
  unlinkChat,
  type InlineButton,
} from "./telegram";
import { basketChange24h, getPortfolio, listBaskets, investorCount } from "./portfolio";
import { getAccountWallet, getSolBalance, LAMPORTS_PER_SOL } from "./accounts";
import { solPriceUsd } from "./treasury";

const openSite: InlineButton[][] = [[{ text: "Open Basket ↗", url: SITE_URL }]];

function linkPrompt(): string {
  return [
    "🧺 <b>Basket</b> — index baskets for the Solana trenches.",
    "",
    "This chat isn't linked to an account yet.",
    "",
    `1. Sign in at <a href="${SITE_URL}/wallet">${SITE_URL.replace(/^https?:\/\//, "")}</a>`,
    "2. Open <b>Wallet → Telegram</b> and tap <b>Generate code</b>",
    "3. Send it here as <code>/start YOURCODE</code>",
    "",
    "<i>The bot is read-only — it reports your positions and never moves funds.</i>",
  ].join("\n");
}

async function cmdPortfolio(chatId: number, userId: number): Promise<void> {
  const { positions, totalValue, totalCost } = await getPortfolio(userId);
  if (positions.length === 0) {
    await sendMessage(
      chatId,
      ["📊 <b>Portfolio</b>", "", "No open positions yet.", "", "Browse baskets and buy your first one on the site."].join("\n"),
      { buttons: [[{ text: "Browse baskets ↗", url: `${SITE_URL}/baskets` }]] }
    );
    return;
  }
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : null;

  const lines = [
    "📊 <b>Portfolio</b>",
    "",
    `Value    <b>${money(totalValue)}</b>`,
    `Cost     ${money(totalCost)}`,
    `P&amp;L      ${pnl >= 0 ? "+" : "−"}${money(Math.abs(pnl)).replace("-", "")}  ${pct(pnlPct)}`,
    "",
    "<b>Positions</b>",
  ];
  for (const p of positions) {
    const ppnl = p.value - p.cost;
    const ppct = p.cost > 0 ? (ppnl / p.cost) * 100 : null;
    lines.push(`• <b>${esc(p.basket.name)}</b> — ${money(p.value)}  ${pct(ppct)}`);
    if (p.rule) {
      const bits: string[] = [];
      if (p.rule.tp_pct != null) bits.push(`TP +${p.rule.tp_pct}%`);
      if (p.rule.sl_pct != null) bits.push(`SL −${p.rule.sl_pct}%`);
      if (p.rule.close_at != null) {
        const days = Math.max(0, Math.round((p.rule.close_at - Date.now()) / 86_400_000));
        bits.push(`close in ${days}d`);
      }
      if (bits.length) lines.push(`   ⏱ ${bits.join(" · ")}`);
    }
    if (p.tokens?.some((t) => t.unpriced)) {
      lines.push("   ⚠️ a leg has no live price");
    }
  }
  await sendMessage(chatId, lines.join("\n"), {
    buttons: [[{ text: "Open portfolio ↗", url: `${SITE_URL}/dashboard` }]],
  });
}

async function cmdWallet(chatId: number, userId: number): Promise<void> {
  const wallet = getAccountWallet(userId);
  if (!wallet) {
    await sendMessage(chatId, "This account has no wallet yet — open the site once to create it.", {
      buttons: openSite,
    });
    return;
  }
  let sol = 0;
  try {
    sol = (await getSolBalance(wallet.address)) / LAMPORTS_PER_SOL;
  } catch {
    /* show 0 rather than fail */
  }
  const price = await solPriceUsd();
  await sendMessage(
    chatId,
    [
      "👛 <b>Wallet</b>",
      "",
      `Balance  <b>${sol.toFixed(4)} SOL</b>${price ? `  ≈ ${money(sol * price)}` : ""}`,
      "",
      "<b>Deposit address</b> (Solana only)",
      `<code>${wallet.address}</code>`,
      "",
      "<i>Tap the address to copy. Only send Solana-network assets — anything from another chain is unrecoverable.</i>",
    ].join("\n"),
    {
      buttons: [
        [{ text: "Wallet page ↗", url: `${SITE_URL}/wallet` }],
        [{ text: "View on Solscan ↗", url: `https://solscan.io/account/${wallet.address}` }],
      ],
    }
  );
}

async function cmdBaskets(chatId: number): Promise<void> {
  const all = listBaskets(null).filter((b) => b.kind === "coin").slice(0, 8);
  const withChange = await Promise.all(
    all.map(async (b) => ({
      b,
      change: await basketChange24h(b),
      investors: investorCount(b.id),
    }))
  );
  withChange.sort((x, y) => (y.change ?? -Infinity) - (x.change ?? -Infinity));

  const lines = ["🧺 <b>Live baskets</b> <i>(24h)</i>", ""];
  for (const { b, change, investors } of withChange) {
    lines.push(
      `• <b>${esc(b.name)}</b>  ${pct(change)}` +
        (investors > 0 ? `  <i>${investors} holder${investors === 1 ? "" : "s"}</i>` : "")
    );
  }
  await sendMessage(chatId, lines.join("\n"), {
    buttons: [
      [{ text: "Browse all ↗", url: `${SITE_URL}/baskets` }],
      [{ text: "Build your own ↗", url: `${SITE_URL}/baskets/new` }],
    ],
  });
}

async function cmdRules(chatId: number, userId: number): Promise<void> {
  const { positions } = await getPortfolio(userId);
  const armed = positions.filter((p) => p.rule);
  if (armed.length === 0) {
    await sendMessage(
      chatId,
      [
        "⏱ <b>Exit rules</b>",
        "",
        "Nothing armed right now.",
        "",
        "Set a take-profit, stop-loss or auto-close on any position and it fires automatically — the bot pings you the moment it does.",
      ].join("\n"),
      { buttons: [[{ text: "Set exit rules ↗", url: `${SITE_URL}/dashboard` }]] }
    );
    return;
  }
  const lines = ["⏱ <b>Armed exit rules</b>", ""];
  for (const p of armed) {
    const ppct = p.cost > 0 ? ((p.value - p.cost) / p.cost) * 100 : null;
    lines.push(`<b>${esc(p.basket.name)}</b> — now ${pct(ppct)}`);
    if (p.rule?.tp_pct != null) lines.push(`   🎯 take profit at +${p.rule.tp_pct}%`);
    if (p.rule?.sl_pct != null) lines.push(`   🛡 stop loss at −${p.rule.sl_pct}%`);
    if (p.rule?.close_at != null) {
      const days = Math.max(0, Math.round((p.rule.close_at - Date.now()) / 86_400_000));
      lines.push(`   ⌛ auto-close in ${days}d`);
    }
    lines.push("");
  }
  await sendMessage(chatId, lines.join("\n").trim(), {
    buttons: [[{ text: "Manage ↗", url: `${SITE_URL}/dashboard` }]],
  });
}

async function cmdKols(chatId: number): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.name, t.wallet,
              (SELECT value FROM wallet_snapshots s WHERE s.trader_id = t.id ORDER BY ts DESC LIMIT 1) AS latest
       FROM traders t
       WHERE t.listed = 1
       ORDER BY latest DESC NULLS LAST
       LIMIT 10`
    )
    .all() as { name: string; wallet: string; latest: number | null }[];

  const withData = rows.filter((r) => r.latest != null && r.latest > 0);
  if (withData.length === 0) {
    await sendMessage(
      chatId,
      [
        "🎯 <b>Tracked KOL wallets</b>",
        "",
        "563 wallets are tracked; on-chain values are still warming up.",
        "Check the site for the live leaderboard.",
      ].join("\n"),
      { buttons: [[{ text: "KOL leaderboard ↗", url: SITE_URL }]] }
    );
    return;
  }
  const lines = ["🎯 <b>Top tracked wallets</b> <i>(on-chain value)</i>", ""];
  withData.forEach((r, i) => {
    lines.push(`${i + 1}. <b>${esc(r.name)}</b> — ${money(r.latest!)}`);
  });
  lines.push("", "<i>Public wallets, attributed via Kolscan. Tracking only.</i>");
  await sendMessage(chatId, lines.join("\n"), {
    buttons: [[{ text: "Full leaderboard ↗", url: SITE_URL }]],
  });
}

function helpText(): string {
  return [
    "🧺 <b>Basket bot</b>",
    "",
    "<b>/portfolio</b> — positions, value, P&amp;L, armed rules",
    "<b>/wallet</b> — balance + deposit address",
    "<b>/baskets</b> — live baskets by 24h performance",
    "<b>/rules</b> — your take-profit / stop-loss / timers",
    "<b>/kols</b> — top tracked KOL wallets",
    "<b>/alerts on|off</b> — exit and fill notifications",
    "<b>/unlink</b> — disconnect this chat",
    "",
    "<b>Alerts you'll get automatically</b>",
    "• 🎯 take-profit fired",
    "• 🛡 stop-loss fired",
    "• ⌛ timed exit closed a position",
    "• ✅ a basket buy filled",
    "",
    "<i>Read-only by design: the bot reports, it never moves your funds. Trading stays on the site behind your login.</i>",
  ].join("\n");
}

/** Route one incoming message. Returns quietly on anything unrecognised. */
export async function handleCommand(
  chatId: number,
  text: string,
  fromUsername: string | null
): Promise<void> {
  const trimmed = text.trim();
  const [rawCmd, ...args] = trimmed.split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, ""); // strip @botname in groups
  const link = getLinkByChat(chatId);

  if (cmd === "/start") {
    const code = args[0];
    if (code) {
      const res = redeemLinkCode(code, chatId, fromUsername);
      if (!res.ok) {
        await sendMessage(chatId, `❌ ${esc(res.error)}`, {
          buttons: [[{ text: "Get a code ↗", url: `${SITE_URL}/wallet` }]],
        });
        return;
      }
      const db = getDb();
      const u = db.prepare("SELECT username FROM users WHERE id = ?").get(res.userId) as
        | { username: string }
        | undefined;
      await sendMessage(
        chatId,
        [
          `✅ Linked to <b>@${esc(u?.username ?? "your account")}</b>.`,
          "",
          "You'll now get alerts when an exit rule fires or a buy fills.",
          "",
          "Try <b>/portfolio</b> to see where you stand.",
        ].join("\n"),
        { buttons: [[{ text: "Open Basket ↗", url: SITE_URL }]] }
      );
      return;
    }
    await sendMessage(chatId, link ? helpText() : linkPrompt(), {
      buttons: link ? undefined : [[{ text: "Get your code ↗", url: `${SITE_URL}/wallet` }]],
    });
    return;
  }

  if (cmd === "/help") {
    await sendMessage(chatId, link ? helpText() : linkPrompt());
    return;
  }

  if (cmd === "/baskets") {
    await cmdBaskets(chatId); // public data — no link required
    return;
  }
  if (cmd === "/kols") {
    await cmdKols(chatId);
    return;
  }

  // everything below needs a linked account
  if (!link) {
    await sendMessage(chatId, linkPrompt(), {
      buttons: [[{ text: "Get your code ↗", url: `${SITE_URL}/wallet` }]],
    });
    return;
  }

  switch (cmd) {
    case "/portfolio":
    case "/p":
      await cmdPortfolio(chatId, link.user_id);
      return;
    case "/wallet":
    case "/w":
      await cmdWallet(chatId, link.user_id);
      return;
    case "/rules":
      await cmdRules(chatId, link.user_id);
      return;
    case "/alerts": {
      const arg = (args[0] ?? "").toLowerCase();
      if (arg === "on" || arg === "off") {
        setAlerts(chatId, arg === "on");
        await sendMessage(chatId, arg === "on" ? "🔔 Alerts on." : "🔕 Alerts off.");
      } else {
        await sendMessage(
          chatId,
          `Alerts are currently <b>${link.alerts_on ? "on" : "off"}</b>.\nUse <code>/alerts on</code> or <code>/alerts off</code>.`
        );
      }
      return;
    }
    case "/unlink":
      unlinkChat(chatId);
      await sendMessage(chatId, "Unlinked. Your account and funds are untouched.");
      return;
    default:
      await sendMessage(chatId, helpText());
  }
}
