import { JSONFilePreset } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'data', 'predictions.json');

async function getDb() {
  const db = await JSONFilePreset(DB_PATH, { predictions: [] });
  return db;
}

export async function savePrediction({ symbol, userId, username, predictedMin, predictedMax, currentPrice, reasoning, confidence }) {
  const db = await getDb();
  const id = Date.now().toString();
  db.data.predictions.push({
    id,
    symbol,
    userId,
    username,
    predictedMin,
    predictedMax,
    currentPrice,
    reasoning,
    confidence,
    createdAt: new Date().toISOString(),
    actualPrice: null,
    hit: null,
  });
  await db.write();
  return id;
}

export async function recordResult({ userId, symbol, actualPrice }) {
  const db = await getDb();
  // Find the most recent open prediction for this user+symbol
  const pred = db.data.predictions
    .filter((p) => p.userId === userId && p.symbol === symbol && p.actualPrice === null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!pred) return null;

  pred.actualPrice = actualPrice;
  pred.hit = actualPrice >= pred.predictedMin && actualPrice <= pred.predictedMax;
  pred.resolvedAt = new Date().toISOString();
  await db.write();
  return pred;
}

export async function getHistory(userId, limit = 10) {
  const db = await getDb();
  return db.data.predictions
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getScore(userId) {
  const db = await getDb();
  const resolved = db.data.predictions.filter((p) => p.userId === userId && p.hit !== null);
  const hits = resolved.filter((p) => p.hit).length;
  return {
    total: resolved.length,
    hits,
    misses: resolved.length - hits,
    accuracy: resolved.length > 0 ? ((hits / resolved.length) * 100).toFixed(1) : null,
  };
}

// Get last N resolved predictions for this symbol (for context)
export async function getRecentSymbolHistory(symbol, limit = 5) {
  const db = await getDb();
  return db.data.predictions
    .filter((p) => p.symbol === symbol && p.hit !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
