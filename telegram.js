const axios = require('axios');

async function sendAlert(coin) {
  const { BOT_TOKEN, CHAT_ID } = process.env;

  const symbol = coin.symbol.toUpperCase();
  const athDrop = coin.ath_change_percentage.toFixed(1);
  const mcap =
    coin.market_cap >= 1e9
      ? `$${(coin.market_cap / 1e9).toFixed(2)}B`
      : `$${(coin.market_cap / 1e6).toFixed(1)}M`;

  const lines = [
    `🔔 *REVIVAL CANDIDATE — $${symbol}*`,
    ``,
    `💰 Price: $${coin.current_price}`,
    `📉 Down from ATH: ${athDrop}%`,
    `📊 RSI (14d): ${coin.rsi} — oversold`,
    `🏦 Market Cap: ${mcap}`,
  ];

  // Add social block if LunarCrush data is present
  if (coin.social) {
    lines.push(``);
    lines.push(`📣 *Social Signal*`);
    if (coin.socialMultiplier) {
      lines.push(`🔥 Mention spike: ${coin.socialMultiplier}x vs last scan`);
    }
    lines.push(`📈 24h mentions: ${coin.social.social_volume_24h.toLocaleString()}`);
    lines.push(`⭐ Galaxy score: ${coin.social.galaxy_score}/100`);
    if (coin.social.sentiment) {
      lines.push(`😀 Sentiment: ${coin.social.sentiment}% bullish`);
    }
  }

  // Add manipulation block
  lines.push(``);
  if (coin.manipulation?.score !== null && coin.manipulation?.score !== undefined) {
    const m = coin.manipulation;
    lines.push(`🔬 *Manipulation Risk: ${m.risk.emoji} ${m.risk.label} (${m.score}/100)*`);
    if (m.flags && m.flags.length > 0) {
      for (const flag of m.flags) {
        lines.push(`  • ${flag}`);
      }
    } else {
      lines.push(`  • No major flags detected`);
    }
  } else {
    lines.push(`🔬 *Manipulation Risk: ❓ Unverified*`);
    lines.push(`  • ${coin.manipulation?.note || 'Could not fetch on-chain data'}`);
  }

  lines.push(``);
  lines.push(`🔍 [Check Twitter](https://twitter.com/search?q=%24${symbol})`);
  lines.push(`📈 [CoinGecko](https://www.coingecko.com/en/coins/${coin.id})`);

  const msg = lines.join('\n');

  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }
  );
}

module.exports = { sendAlert };
