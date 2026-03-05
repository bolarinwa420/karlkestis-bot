import 'dotenv/config';
import { Bot } from 'grammy';
import { getPriceData } from './price.js';
import { generatePrediction } from './predictor.js';
import { savePrediction, recordResult, getHistory, getScore } from './memory.js';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// ─────────────────────────────────────────
// /start
// ─────────────────────────────────────────
bot.command('start', (ctx) => {
  ctx.reply(
    `*signals.wtf Prediction Helper* 🎯\n\n` +
    `AI-powered price range predictions — signals.wtf style.\n\n` +
    `Commands:\n` +
    `/predict BTC [price] — get min/max range + win probability\n` +
    `/result BTC 73500 — log actual close price\n` +
    `/history — your last 10 predictions\n` +
    `/score — your accuracy stats\n\n` +
    `Coins: BTC ETH SOL BNB DOGE`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────
// /predict <SYMBOL>
// ─────────────────────────────────────────
bot.command('predict', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const symbol = args[0]?.toUpperCase();
  const manualPrice = args[1] ? parseFloat(args[1].replace(/,/g, '')) : null;

  if (!symbol) {
    return ctx.reply('Usage: /predict BTC [price]\nExample: /predict BTC 72772\nSupported: BTC ETH SOL BNB DOGE');
  }

  const thinking = await ctx.reply(`Fetching ${symbol} data and analyzing... ⏳`);

  try {
    const priceData = await getPriceData(symbol);
    if (manualPrice && !isNaN(manualPrice)) {
      priceData.currentPrice = manualPrice;
      console.log(`[predict] Manual price override: ${manualPrice}`);
    } else {
      console.log(`[predict] CoinGecko price: ${priceData.currentPrice}`);
    }
    const prediction = await generatePrediction(priceData);

    const id = await savePrediction({
      symbol,
      userId: ctx.from.id,
      username: ctx.from.username || ctx.from.first_name,
      predictedMin: prediction.min,
      predictedMax: prediction.max,
      currentPrice: priceData.currentPrice,
      reasoning: prediction.reasoning,
      confidence: prediction.confidence,
    });

    const confidenceEmoji = { High: '🟢', Medium: '🟡', Low: '🔴' }[prediction.confidence] || '⚪';
    const rangeWidth = prediction.max - prediction.min;
    const inc = { BTC: 200, ETH: 10, SOL: 5, BNB: 5, DOGE: 0.01 }[symbol] ?? 1;
    const buckets = Math.round(rangeWidth / inc);
    const safe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const msg =
      `<b>${symbol} — signals.wtf Range</b>\n` +
      `─────────────────────\n` +
      `💰 Current Price: <b>$${priceData.currentPrice.toLocaleString()}</b>\n` +
      `🎯 Most Likely: <b>$${prediction.mostLikelyPrice.toLocaleString()}</b>\n\n` +
      `📉 Min Price: <b>$${prediction.min.toLocaleString()}</b>\n` +
      `📈 Max Price: <b>$${prediction.max.toLocaleString()}</b>\n` +
      `📏 Range: $${rangeWidth.toLocaleString()} (${buckets} buckets × $${inc})\n\n` +
      `${prediction.winProbability ? `🎲 Est. Win Probability: <b>${prediction.winProbability}%</b>\n` : ''}` +
      `${confidenceEmoji} Confidence: ${prediction.confidence}\n\n` +
      `💭 <b>Analysis:</b>\n${safe(prediction.reasoning)}\n\n` +
      `<i>Log the close price later:</i>\n` +
      `/result ${symbol} &lt;actual_price&gt;`;

    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, msg, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      thinking.message_id,
      `Error: ${err.message}`
    );
  }
});

// ─────────────────────────────────────────
// /result <SYMBOL> <PRICE>
// ─────────────────────────────────────────
bot.command('result', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const symbol = args[0]?.toUpperCase();
  const actualPrice = parseFloat(args[1]);

  if (!symbol || isNaN(actualPrice)) {
    return ctx.reply('Usage: /result BTC 73500');
  }

  const pred = await recordResult({ userId: ctx.from.id, symbol, actualPrice });

  if (!pred) {
    return ctx.reply(`No open prediction found for ${symbol}. Run /predict ${symbol} first.`);
  }

  const hitEmoji = pred.hit ? '✅' : '❌';
  const msg =
    `*${symbol} Result Logged* ${hitEmoji}\n\n` +
    `Predicted Range: $${pred.predictedMin.toLocaleString()} – $${pred.predictedMax.toLocaleString()}\n` +
    `Actual Close: *$${actualPrice.toLocaleString()}*\n\n` +
    (pred.hit
      ? `🎯 Within range! Nice call.`
      : `💀 Outside range. Better luck next time.\n` +
        (actualPrice < pred.predictedMin
          ? `_Was $${(pred.predictedMin - actualPrice).toLocaleString()} below your min._`
          : `_Was $${(actualPrice - pred.predictedMax).toLocaleString()} above your max._`)
    );

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─────────────────────────────────────────
// /history
// ─────────────────────────────────────────
bot.command('history', async (ctx) => {
  const history = await getHistory(ctx.from.id, 10);

  if (history.length === 0) {
    return ctx.reply('No predictions yet. Try /predict BTC');
  }

  const lines = history.map((p, i) => {
    const date = p.createdAt.slice(0, 10);
    const status = p.hit === null ? '⏳' : p.hit ? '✅' : '❌';
    const range = `$${p.predictedMin.toLocaleString()}–$${p.predictedMax.toLocaleString()}`;
    const actual = p.actualPrice ? `→ $${p.actualPrice.toLocaleString()}` : '(pending)';
    return `${status} [${date}] *${p.symbol}* ${range} ${actual}`;
  });

  ctx.reply(`*Your Last ${history.length} Predictions:*\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
  });
});

// ─────────────────────────────────────────
// /score
// ─────────────────────────────────────────
bot.command('score', async (ctx) => {
  const score = await getScore(ctx.from.id);

  if (score.total === 0) {
    return ctx.reply('No resolved predictions yet.\nMake a /predict then log the /result to track accuracy.');
  }

  const bar = score.accuracy
    ? '█'.repeat(Math.round(score.accuracy / 10)) + '░'.repeat(10 - Math.round(score.accuracy / 10))
    : '░░░░░░░░░░';

  const grade =
    score.accuracy >= 80 ? '🏆 Elite' :
    score.accuracy >= 60 ? '🎯 Sharp' :
    score.accuracy >= 40 ? '📊 Learning' : '💀 Rough patch';

  ctx.reply(
    `*Your Prediction Score*\n\n` +
    `[${bar}] ${score.accuracy}%\n\n` +
    `✅ Hits: ${score.hits}\n` +
    `❌ Misses: ${score.misses}\n` +
    `Total: ${score.total}\n\n` +
    `Rating: ${grade}`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────
bot.catch((err) => console.error('Bot error:', err));

bot.start();
console.log('Crypto Predictor Bot running...');
