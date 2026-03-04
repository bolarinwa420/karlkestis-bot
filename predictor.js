import Anthropic from '@anthropic-ai/sdk';
import { getRecentSymbolHistory } from './memory.js';

const client = new Anthropic();

// Round to nearest increment (signals.wtf uses $200 for BTC)
const INCREMENTS = { BTC: 200, ETH: 10, SOL: 5, BNB: 5, DOGE: 0.01 };

function roundToIncrement(price, symbol) {
  const inc = INCREMENTS[symbol] ?? 1;
  return Math.round(price / inc) * inc;
}

// Estimate win probability using normal distribution approximation
// Based on daily volatility vs range width
function estimateWinProbability(currentPrice, min, max, recentCloses) {
  if (recentCloses.length < 3) return null;

  // Calculate daily % changes
  const changes = [];
  for (let i = 1; i < recentCloses.length; i++) {
    changes.push((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]);
  }

  // Daily volatility (std dev of % changes)
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / changes.length;
  const dailyVol = Math.sqrt(variance);

  // Z-scores for min and max relative to current price
  const zMin = (min - currentPrice) / (currentPrice * dailyVol);
  const zMax = (max - currentPrice) / (currentPrice * dailyVol);

  // Normal CDF approximation (error function)
  function normCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const poly = t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    const cdf = 1 - d * poly;
    return z >= 0 ? cdf : 1 - cdf;
  }

  const prob = (normCDF(zMax) - normCDF(zMin)) * 100;
  return Math.min(99, Math.max(1, prob)).toFixed(1);
}

export async function generatePrediction(priceData) {
  const { symbol } = priceData;
  const inc = INCREMENTS[symbol] ?? 1;

  const pastPreds = await getRecentSymbolHistory(symbol, 5);
  const memoryContext = pastPreds.length > 0
    ? `\nPast predictions for ${symbol}:\n` +
      pastPreds.map((p) =>
        `- Range $${p.predictedMin.toLocaleString()}–$${p.predictedMax.toLocaleString()}, Actual: $${p.actualPrice?.toLocaleString() ?? 'N/A'}, ${p.hit ? 'HIT' : 'MISS'}`
      ).join('\n')
    : '\nNo past prediction history yet.';

  const systemPrompt = `You are a signals.wtf-style crypto price range predictor. You suggest a realistic end-of-day price range for betting purposes.

Output ONLY valid JSON:
{
  "min": <number>,
  "max": <number>,
  "mostLikelyPrice": <number>,
  "confidence": "<Low|Medium|High>",
  "reasoning": "<2-3 sentences covering trend, key levels, and risks>"
}

Rules:
- Round ALL prices to nearest $${inc} increment
- Range should be realistic — if trend is clear, go tighter. If choppy, go wider
- mostLikelyPrice is your single best guess within the range
- Confidence: High = clear trend + tight range, Medium = mixed signals, Low = high uncertainty`;

  const userPrompt = `Predict end-of-day price range for ${symbol} (signals.wtf style).

Current price: $${priceData.currentPrice.toLocaleString()}
24h change: ${priceData.priceChange24h?.toFixed(2)}%
7d change: ${priceData.priceChange7d?.toFixed(2)}%
24h high: $${priceData.high24h?.toLocaleString()}
24h low: $${priceData.low24h?.toLocaleString()}

Recent OHLC candles:
${priceData.ohlcSample.map((c) => `  ${c.time.slice(0, 16)} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}`).join('\n')}
${memoryContext}

Output JSON only.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude returned non-JSON: ' + text);

  const result = JSON.parse(jsonMatch[0]);
  if (!result.min || !result.max) throw new Error('Missing min/max in prediction');

  // Force $200 increment rounding
  result.min = roundToIncrement(result.min, symbol);
  result.max = roundToIncrement(result.max, symbol);
  result.mostLikelyPrice = roundToIncrement(result.mostLikelyPrice ?? (result.min + result.max) / 2, symbol);

  // Calculate win probability from volatility
  result.winProbability = estimateWinProbability(
    priceData.currentPrice,
    result.min,
    result.max,
    priceData.recentCloses
  );

  return result;
}
