require('dotenv').config();
const { Bot } = require('grammy');
const { analyzeToken, formatPrice, formatUSD, pctStr } = require('./analyze');

const bot = new Bot(process.env.BOT_TOKEN);

// --- /start ---
bot.command('start', (ctx) =>
  ctx.reply(
    '*Karlkestis Analysis Bot*\n\n' +
    'Paste any token and get a full trading analysis.\n\n' +
    'Commands:\n' +
    '`/analyze <token>` — full analysis report\n' +
    '`/help` — how to use\n\n' +
    'Examples:\n' +
    '`/analyze PEPE`\n' +
    '`/analyze bonk`\n' +
    '`/analyze 0xabc123...` (contract address)',
    { parse_mode: 'Markdown' }
  )
);

// --- /help ---
bot.command('help', (ctx) =>
  ctx.reply(
    '*How to use /analyze:*\n\n' +
    '`/analyze <name or symbol>` — search by name\n' +
    '`/analyze <contract address>` — most accurate\n\n' +
    '*What you get:*\n' +
    '• Live price, volume, liquidity\n' +
    '• Price action (5m / 1h / 6h / 24h)\n' +
    '• RSI(14) if available\n' +
    '• Entry zones + 3 DCA levels\n' +
    '• 3 take profit targets + stop loss\n' +
    '• Manipulation risk check\n' +
    '• Tradability score (0–10)\n\n' +
    '_Tip: contract address gives the most accurate result when multiple tokens share the same name._',
    { parse_mode: 'Markdown' }
  )
);

// --- /analyze ---
bot.command('analyze', async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply(
      'Usage: `/analyze <token name, symbol, or contract>`\n\nExample: `/analyze PEPE`',
      { parse_mode: 'Markdown' }
    );
  }

  const loading = await ctx.reply(`🔍 Analyzing *${query}*...\n_Fetching price, volume, on-chain data — takes ~10s_`, {
    parse_mode: 'Markdown',
  });

  try {
    const data = await analyzeToken(query);

    if (data.error) {
      return ctx.reply(`❌ ${data.error}`);
    }

    const msg = buildReport(data);
    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('Analyze command error:', err.message);
    await ctx.reply(`❌ Analysis failed: ${err.message}`);
  }
});

// --- Format the full report ---
function buildReport(d) {
  const lines = [];
  const p = d.priceUsd;

  // Header
  lines.push(`🔍 *${d.symbol} — ${d.name || 'Unknown'}*`);
  lines.push(`Chain: \`${d.chainId}\`  |  DEX: ${d.dexId}`);
  if (d.dexUrl) lines.push(`[View pair on DexScreener](${d.dexUrl})`);
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
  if (d.cgId) {
    lines.push(`📈 [CoinGecko](https://www.coingecko.com/en/coins/${d.cgId})`);
  }
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
console.log('Karlkestis analysis bot started. Send /analyze <token> in Telegram.');
