require('dotenv').config();
const axios = require('axios');

const CG_KEY = process.env.COINGECKO_API_KEY;
const CG_BASE = CG_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

// --- Fear & Greed Index (alternative.me — free, no key needed) ---
// Cached for 30 minutes — it only updates once a day anyway
let fgCache = null;
let fgCacheTime = 0;

async function getFearGreed() {
  if (fgCache && Date.now() - fgCacheTime < 30 * 60 * 1000) return fgCache;
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
    const d = res.data?.data?.[0];
    if (!d) return null;
    const val = parseInt(d.value);
    const emoji =
      val <= 20 ? '😱' :
      val <= 40 ? '😰' :
      val <= 60 ? '😐' :
      val <= 80 ? '😏' : '🤑';
    fgCache = { value: val, label: d.value_classification, emoji };
    fgCacheTime = Date.now();
    return fgCache;
  } catch {
    return null;
  }
}

// --- CoinGecko trending (most searched coins in last 24h) ---
async function getTrendingCoins() {
  try {
    const headers = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};
    const res = await axios.get(`${CG_BASE}/search/trending`, { headers, timeout: 8000 });
    const coins = res.data?.coins || [];
    return coins.slice(0, 7).map((c) => ({
      name: c.item.name,
      symbol: c.item.symbol?.toUpperCase(),
      rank: c.item.market_cap_rank || null,
      change24h: c.item.data?.price_change_percentage_24h?.usd ?? null,
    }));
  } catch {
    return [];
  }
}

// --- CoinGecko top 5 gainers (24h) ---
async function getTopGainers() {
  try {
    const headers = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};
    const res = await axios.get(`${CG_BASE}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        order: 'price_change_percentage_24h_desc',
        per_page: 5,
        page: 1,
        sparkline: false,
        price_change_percentage: '24h',
      },
      headers,
      timeout: 8000,
    });
    return (res.data || []).map((d) => ({
      name: d.name,
      symbol: d.symbol?.toUpperCase(),
      change24h: d.price_change_percentage_24h,
      price: d.current_price,
    }));
  } catch {
    return [];
  }
}

module.exports = { getFearGreed, getTrendingCoins, getTopGainers };
