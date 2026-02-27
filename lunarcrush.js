const axios = require('axios');

const BASE_URL = 'https://lunarcrush.com/api4/public';

// Fetches social data for ALL tracked coins in ONE call
// Returns a lookup map: symbol.toLowerCase() -> social metrics
async function getSocialMap() {
  const res = await axios.get(`${BASE_URL}/coins/list/v2`, {
    headers: {
      Authorization: `Bearer ${process.env.LUNARCRUSH_API_KEY}`,
    },
  });

  const map = {};
  for (const coin of res.data.data) {
    map[coin.symbol.toLowerCase()] = {
      social_volume_24h: coin.social_volume_24h || 0,
      galaxy_score: coin.galaxy_score || 0,    // 0-100, higher = more social activity
      alt_rank: coin.alt_rank || 9999,          // lower = more social relative to market cap
      sentiment: coin.sentiment || 0,           // % bullish mentions
    };
  }
  return map;
}

module.exports = { getSocialMap };
