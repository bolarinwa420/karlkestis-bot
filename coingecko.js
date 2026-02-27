const axios = require('axios');

const BASE_URL = 'https://api.coingecko.com/api/v3';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries on 429 with exponential backoff
async function fetchWithRetry(url, params, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const headers = {};
      if (process.env.COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
      }
      const res = await axios.get(url, { params, headers });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < retries) {
        const wait = attempt * 15000; // 15s, 30s, 45s
        console.log(`  Rate limited. Waiting ${wait / 1000}s before retry ${attempt}/${retries - 1}...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

async function getMarkets(page = 1) {
  return fetchWithRetry(`${BASE_URL}/coins/markets`, {
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: 250,
    page,
    sparkline: false,
  });
}

async function getPriceHistory(coinId) {
  const data = await fetchWithRetry(`${BASE_URL}/coins/${coinId}/market_chart`, {
    vs_currency: 'usd',
    days: 30,
    interval: 'daily',
  });
  return data.prices.map((p) => p[1]);
}

module.exports = { getMarkets, getPriceHistory };
