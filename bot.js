require('dotenv').config();
const { Bot } = require('grammy');
const { analyzeToken, formatPrice, formatUSD, pctStr } = require('./analyze');
const {
  addAlert, getAlerts, removeAlertsAt, clearAllAlerts, allAlertEntries,
  addWatch, removeWatch, getWatchlist, allWatchEntries, canAlertWatch,
} = require('./alerts');

const bot = new Bot(process.env.BOT_TOKEN);

// Tokens that are almost certainly EVM-native — warn if found on Solana
const EVM_NATIVE = new Set(['BTC', 'WBTC', 'ETH', 'WETH', 'BNB', 'MATIC', 'AVAX', 'LINK', 'UNI', 'AAVE', 'CRV', 'MKR', 'SNX', 'ARB', 'OP']);

// --- Register command menu with Telegram (shows in the "/" menu bar) ---
bot.api.setMyCommands([
  { command: 'a',         description: 'Analyze any token — /a PEPE' },
  { command: 'analyze',   description: 'Full token analysis — /analyze BTC' },
  { command: 'alert',     description: 'Price alert — /alert BTC 90000' },
  { command: 'alerts',    description: 'List or clear your active alerts' },
  { command: 'watch',     description: 'Add to watchlist — /watch SOL' },
  { command: 'unwatch',   description: 'Remove from watchlist — /unwatch SOL' },
  { command: 'watchlist', description: 'Show your watchlist' },
  { command: 'help',      description: 'How to use the bot' },
  { command: 'start',     description: 'Welcome & command overview' },
]).catch((err) => console.error('Failed to set commands:', err.message));

// --- /start ---
bot.command('start', (ctx) =>
  ctx.reply(
    '👁 *Karlkestis — Token Analysis Bot*\n' +
    '─────────────────────────\n\n' +
    '*🔍 Analyze*\n' +
    '`/a <token>` — quick analysis\n' +
    '`/analyze <token>` — same thing\n' +
    '_Use name, symbol, or contract address_\n\n' +
    '*🔔 Price Alerts*\n' +
    '`/alert BTC 90000` — fires when price hits target\n' +
    '`/alerts` — see active alerts\n' +
    '`/alerts clear` — cancel all\n\n' +
    '*👁 Watchlist*\n' +
    '`/watch SOL` — alerts on big moves (≥5% 1h or ≥10% 24h)\n' +
    '`/unwatch SOL` — stop watching\n' +
    '`/watchlist` — see what you\'re tracking\n\n' +
    '*❓ Help*\n' +
    '`/help` — full usage guide\n\n' +
    '─────────────────────────\n' +
    '_Tap the `/` button below to see all commands._',
    { parse_mode: 'Markdown' }
  )
);

// --- /help ---
bot.command('help', (ctx) =>
  ctx.reply(
    '*How to use:*\n\n' +
    '*Analyze a token:*\n' +
    '`/analyze <name, symbol, or contract>` (or `/a`)\n' +
    '_Tip: contract address = most accurate result_\n\n' +
    '*Price alerts:*\n' +
    '`/alert BTC 90000` — fires when BTC hits $90K\n' +
    '`/alerts` — list your active alerts\n' +
    '`/alerts clear` — cancel all alerts\n\n' +
    '*Watchlist:*\n' +
    '`/watch SOL` — get notified on big moves (1h ≥5% or 24h ≥10%)\n' +
    '`/unwatch SOL` — stop watching\n' +
    '`/watchlist` — see what you\'re watching\n\n' +
    '*What analyze gives you:*\n' +
    '• Live price, volume, liquidity\n' +
    '• Price action (5m / 1h / 6h / 24h)\n' +
    '• RSI(14) from 30-day history\n' +
    '• Entry zones + 3 DCA levels\n' +
    '• 3 take profit targets + stop loss\n' +
    '• Manipulation risk check\n' +
    '• Tradability score (0–10)',
    { parse_mode: 'Markdown' }
  )
);

// --- Shared analyze handler ---
async function handleAnalyze(ctx, query) {
  if (!query) {
    return ctx.reply(
      'Usage: `/a <token name, symbol, or contract>`\n\nExample: `/a PEPE`',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply(`🔍 Analyzing *${query}*...\n_Takes ~10s_`, { parse_mode: 'Markdown' });

  try {
    const data = await analyzeToken(query);
    if (data.error) return ctx.reply(`❌ ${data.error}`);
    await ctx.reply(buildReport(data), {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('Analyze error:', err.message);
    await ctx.reply(`❌ Analysis failed: ${err.message}`);
  }
}

// --- /analyze + /a (alias) ---
bot.command('analyze', (ctx) => handleAnalyze(ctx, ctx.match?.trim()));
bot.command('a', (ctx) => handleAnalyze(ctx, ctx.match?.trim()));

// --- /alert <token> <price> ---
bot.command('alert', async (ctx) => {
  const parts = ctx.match?.trim().split(/\s+/);
  if (!parts || parts.length < 2) {
    return ctx.reply(
      'Usage: `/alert <token> <price>`\n\nExample: `/alert BTC 90000`\n_Fires when the token hits that price._',
      { parse_mode: 'Markdown' }
    );
  }

  const query = parts[0];
  const targetPrice = parseFloat(parts[1]);
  if (isNaN(targetPrice) || targetPrice <= 0) {
    return ctx.reply('❌ Invalid price. Example: `/alert BTC 90000`', { parse_mode: 'Markdown' });
  }

  const loading = await ctx.reply(`⏳ Checking current price of *${query}*...`, { parse_mode: 'Markdown' });

  try {
    const data = await analyzeToken(query);
    if (data.error || !data.priceUsd) {
      return ctx.reply(`❌ Couldn't fetch price for "${query}". Try a contract address.`);
    }

    const currentPrice = data.priceUsd;
    const direction = targetPrice > currentPrice ? 'above' : 'below';
    const chatId = String(ctx.chat.id);
    addAlert(chatId, query, targetPrice, direction);

    const arrow = direction === 'above' ? '📈' : '📉';
    await ctx.reply(
      `${arrow} *Alert set for ${data.symbol}*\n\n` +
      `Current price: $${formatPrice(currentPrice)}\n` +
      `Alert when: $${formatPrice(targetPrice)} (${direction})\n\n` +
      `_I'll message you when it hits. Alerts reset if bot restarts._`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply(`❌ Failed to set alert: ${err.message}`);
  }
});

// --- /alerts ---
bot.command('alerts', async (ctx) => {
  const arg = ctx.match?.trim().toLowerCase();
  const chatId = String(ctx.chat.id);

  if (arg === 'clear') {
    clearAllAlerts(chatId);
    return ctx.reply('🗑️ All price alerts cleared.');
  }

  const list = getAlerts(chatId);
  if (list.length === 0) {
    return ctx.reply('You have no active price alerts.\n\nSet one with `/alert BTC 90000`', { parse_mode: 'Markdown' });
  }

  const lines = ['🔔 *Your Active Price Alerts:*\n'];
  list.forEach((a, i) => {
    const arrow = a.direction === 'above' ? '📈' : '📉';
    lines.push(`${i + 1}. ${arrow} ${a.query.toUpperCase()} — $${formatPrice(a.targetPrice)} (${a.direction})`);
  });
  lines.push('\n_Use `/alerts clear` to cancel all._');
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// --- /watch <token> ---
bot.command('watch', async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply(
      'Usage: `/watch <token>`\n\nExample: `/watch SOL`\n_Alerts you when 1h moves ≥5% or 24h moves ≥10%._',
      { parse_mode: 'Markdown' }
    );
  }

  const chatId = String(ctx.chat.id);
  const added = addWatch(chatId, query);
  if (!added) {
    return ctx.reply(`👁️ *${query.toUpperCase()}* is already on your watchlist.`, { parse_mode: 'Markdown' });
  }

  const list = getWatchlist(chatId);
  await ctx.reply(
    `👁️ *${query.toUpperCase()}* added to watchlist.\n\n` +
    `You're watching ${list.length} token${list.length !== 1 ? 's' : ''}. I'll alert on big moves every ~hour.`,
    { parse_mode: 'Markdown' }
  );
});

// --- /unwatch <token> ---
bot.command('unwatch', async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply('Usage: `/unwatch <token>`\n\nExample: `/unwatch SOL`', { parse_mode: 'Markdown' });
  }

  const chatId = String(ctx.chat.id);
  const removed = removeWatch(chatId, query);
  if (!removed) {
    return ctx.reply(`*${query.toUpperCase()}* wasn't on your watchlist.`, { parse_mode: 'Markdown' });
  }
  await ctx.reply(`🗑️ *${query.toUpperCase()}* removed from watchlist.`, { parse_mode: 'Markdown' });
});

// --- /watchlist ---
bot.command('watchlist', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const list = getWatchlist(chatId);

  if (list.length === 0) {
    return ctx.reply(
      'Your watchlist is empty.\n\nAdd tokens with `/watch SOL`',
      { parse_mode: 'Markdown' }
    );
  }

  const lines = [`👁️ *Your Watchlist (${list.length} tokens):*\n`];
  list.forEach((w, i) => lines.push(`${i + 1}. ${w.query.toUpperCase()}`));
  lines.push('\n_Alerts fire when 1h ≥5% or 24h ≥10% move detected._');
  lines.push('_Use `/unwatch <token>` to remove._');
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// --- Background: check price alerts every 5 minutes ---
async function checkPriceAlerts() {
  const entries = allAlertEntries();
  if (entries.length === 0) return;

  for (const [chatId, alerts] of entries) {
    if (alerts.length === 0) continue;

    // Deduplicate queries to avoid fetching same token twice
    const queries = [...new Set(alerts.map((a) => a.query.toLowerCase()))];

    for (const query of queries) {
      try {
        const data = await analyzeToken(query);
        if (data.error || !data.priceUsd) continue;

        const price = data.priceUsd;
        const triggered = [];

        alerts.forEach((alert, i) => {
          if (alert.query.toLowerCase() !== query) return;
          const hit = alert.direction === 'above'
            ? price >= alert.targetPrice
            : price <= alert.targetPrice;
          if (hit) triggered.push(i);
        });

        if (triggered.length > 0) {
          for (const i of triggered) {
            const a = alerts[i];
            const arrow = a.direction === 'above' ? '🚀' : '📉';
            await bot.api.sendMessage(
              chatId,
              `${arrow} *Price Alert: ${data.symbol}*\n\n` +
              `Hit $${formatPrice(price)} (target was $${formatPrice(a.targetPrice)})\n\n` +
              `Use /a ${a.query} for full analysis.`,
              { parse_mode: 'Markdown' }
            );
          }
          removeAlertsAt(chatId, triggered);
        }
      } catch (err) {
        console.error('Alert check error:', err.message);
      }
    }
  }
}

// --- Background: check watchlist every 60 minutes ---
async function checkWatchlist() {
  const entries = allWatchEntries();
  if (entries.length === 0) return;

  for (const [chatId, watches] of entries) {
    for (const watch of watches) {
      try {
        const data = await analyzeToken(watch.query);
        if (data.error || !data.priceUsd) continue;

        const h1 = data.priceChange?.h1;
        const h24 = data.priceChange?.h24;

        const bigMove =
          (h1 !== null && h1 !== undefined && Math.abs(h1) >= 5) ||
          (h24 !== null && h24 !== undefined && Math.abs(h24) >= 10);

        if (bigMove && canAlertWatch(chatId, watch.query)) {
          const emoji = (h1 > 0 || h24 > 0) ? '🚀' : '📉';
          await bot.api.sendMessage(
            chatId,
            `👁️ *Watchlist: ${data.symbol} is moving*\n\n` +
            `${emoji} 1h: ${pctStr(h1)}  |  24h: ${pctStr(h24)}\n` +
            `Price: $${formatPrice(data.priceUsd)}\n\n` +
            `Use /a ${watch.query} for full analysis.`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (err) {
        console.error('Watchlist check error:', err.message);
      }
    }
  }
}

// Start background checks
setInterval(checkPriceAlerts, 5 * 60 * 1000);   // every 5 minutes
setInterval(checkWatchlist, 60 * 60 * 1000);     // every 60 minutes

// --- Format the full report ---
function buildReport(d) {
  const lines = [];
  const p = d.priceUsd;

  // Header
  lines.push(`🔍 *${d.symbol} — ${d.name || 'Unknown'}*`);
  if (d.chainId) lines.push(`Chain: \`${d.chainId}\`  |  DEX: ${d.dexId || 'N/A'}`);
  if (d.dexUrl) lines.push(`[View on DexScreener](${d.dexUrl})`);

  // Solana chain warning for EVM-native tokens
  if (d.chainId === 'solana' && EVM_NATIVE.has(d.symbol?.toUpperCase())) {
    lines.push(`⚠️ _Warning: This appears to be a wrapped/bridged version on Solana. Verify the contract address._`);
  }
  lines.push('');

  // Market data
  lines.push('💰 *Market Data*');
  lines.push(`Price:      $${formatPrice(p)}`);
  lines.push(`Market Cap: ${formatUSD(d.marketCap)}`);
  lines.push(`Liquidity:  ${formatUSD(d.liquidity)}`);
  lines.push(`24h Volume: ${formatUSD(d.volume24h)}`);
  if (d.volMcapRatio > 0) {
    lines.push(`Vol/MCap:   ${d.volMcapRatio.toFixed(1)}% ${d.volMcapRatio >= 5 ? '✅' : d.volMcapRatio >= 1 ? '⚠️' : '🔴'}`);
  }
  if (d.volumeTrend) lines.push(`Vol Trend:  ${d.volumeTrend}`);
  lines.push('');

  // Price action
  lines.push('📊 *Price Action*');
  lines.push(`5m:  ${pctStr(d.priceChange.m5)}`);
  lines.push(`1h:  ${pctStr(d.priceChange.h1)}`);
  lines.push(`6h:  ${pctStr(d.priceChange.h6)}`);
  lines.push(`24h: ${pctStr(d.priceChange.h24)}`);
  if (d.rsi !== null && d.rsi !== undefined) {
    const rsiLabel =
      d.rsi < 30 ? '🟢 oversold' :
      d.rsi > 70 ? '🔴 overbought' :
      '— neutral';
    lines.push(`RSI(14): ${d.rsi.toFixed(1)} ${rsiLabel}`);
  } else {
    lines.push(`RSI(14): N/A`);
  }
  lines.push('');

  // Entry zones
  const hasHistory = d.zones.hasHistory;
  lines.push(`📍 *Entry Zones* ${hasHistory ? '_(from price history)_' : '_(estimated)_'}`);
  lines.push(`Aggressive: $${formatPrice(d.zones.entryAggressive)}`);
  lines.push(`Safe entry: $${formatPrice(d.zones.entrySafe)}`);
  lines.push(`DCA 1:      $${formatPrice(d.zones.dca1)}`);
  lines.push(`DCA 2:      $${formatPrice(d.zones.dca2)}`);
  lines.push(`DCA 3:      $${formatPrice(d.zones.dca3)}`);
  lines.push('');

  // Take profits
  lines.push('🎯 *Take Profit Zones*');
  lines.push(`TP1: $${formatPrice(d.zones.tp1)}  (+${pct(p, d.zones.tp1)})`);
  lines.push(`TP2: $${formatPrice(d.zones.tp2)}  (+${pct(p, d.zones.tp2)})`);
  lines.push(`TP3: $${formatPrice(d.zones.tp3)}  (+${pct(p, d.zones.tp3)})`);
  lines.push(`SL:  $${formatPrice(d.zones.stopLoss)}  (-${pct(p, d.zones.stopLoss, true)})`);
  lines.push('');

  // Manipulation risk
  if (d.manipulation?.score !== null && d.manipulation?.score !== undefined) {
    const m = d.manipulation;
    lines.push(`🔬 *Manipulation Risk: ${m.risk.emoji} ${m.risk.label} (${m.score}/100)*`);
    if (m.flags?.length > 0) {
      for (const flag of m.flags) lines.push(`  • ${flag}`);
    } else {
      lines.push('  • No major flags detected');
    }
  } else {
    lines.push('🔬 *Manipulation Risk: ❓ Unverified*');
    lines.push(`  • ${d.manipulation?.note || 'Not found on DexScreener / GoPlus'}`);
  }
  lines.push('');

  // Tradability score
  const t = d.tradability;
  lines.push(`🏆 *Tradability: ${t.score}/10 — ${t.label}*`);
  for (const r of t.reasons) lines.push(`  • ${r}`);

  // Links
  lines.push('');
  if (d.cgId) lines.push(`📈 [CoinGecko](https://www.coingecko.com/en/coins/${d.cgId})`);
  lines.push(`🐦 [Twitter search](https://twitter.com/search?q=%24${d.symbol})`);

  return lines.join('\n');
}

// Helper: percent change from base to target
function pct(base, target, inverse = false) {
  if (!base || !target) return 'N/A';
  const ratio = ((target / base) - 1) * 100;
  const val = inverse ? Math.abs(ratio) : ratio;
  return `${val.toFixed(0)}%`;
}

// --- Error handler ---
bot.catch((err) => {
  console.error('Bot error:', err.message);
});

// --- Start ---
bot.start();
console.log('Karlkestis analysis bot started.');
