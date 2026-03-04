import axios from 'axios';

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  DOGE: 'dogecoin',
};

export function resolveCoinId(symbol) {
  const id = COINGECKO_IDS[symbol.toUpperCase()];
  if (!id) throw new Error(`Unknown symbol: ${symbol}. Supported: ${Object.keys(COINGECKO_IDS).join(', ')}`);
  return id;
}

export async function getPriceData(symbol) {
  const coinId = resolveCoinId(symbol);

  // Current price + market data
  const [marketRes, ohlcRes] = await Promise.all([
    axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`, {
      params: {
        localization: false,
        tickers: false,
        community_data: false,
        developer_data: false,
      },
    }),
    // 7-day hourly OHLC (free endpoint)
    axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc`, {
      params: { vs_currency: 'usd', days: 7 },
    }),
  ]);

  const market = marketRes.data.market_data;
  const ohlc = ohlcRes.data; // [[timestamp, open, high, low, close], ...]

  // Last 24 candles (approx 24h of 1h-ish candles) — CoinGecko returns 4h candles for 7d
  const recent = ohlc.slice(-24);
  const closes = recent.map((c) => c[4]);
  const highs = recent.map((c) => c[2]);
  const lows = recent.map((c) => c[3]);

  return {
    symbol: symbol.toUpperCase(),
    currentPrice: market.current_price.usd,
    priceChange24h: market.price_change_percentage_24h,
    priceChange7d: market.price_change_percentage_7d,
    high24h: market.high_24h.usd,
    low24h: market.low_24h.usd,
    ath: market.ath.usd,
    marketCap: market.market_cap.usd,
    recentCloses: closes,
    recentHighs: highs,
    recentLows: lows,
    ohlcSample: recent.slice(-6).map((c) => ({
      time: new Date(c[0]).toISOString(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
    })),
  };
}
