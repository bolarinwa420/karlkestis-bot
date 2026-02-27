require('dotenv').config();
const axios = require('axios');
const { calculateRSI } = require('./rsi');
const { getManipulationScore } = require('./manipulation');

const CG_KEY = process.env.COINGECKO_API_KEY;
const CG_BASE = CG_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

// --- Formatters ---
function formatPrice(price) {
  if (!price || price === 0) return '0';
  if (price < 0.000001) return price.toExponential(4);
  if (price < 0.0001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 1000) return price.toFixed(4);
  return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatUSD(n) {
  if (!n || n === 0) return 'N/A';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function pctStr(n) {
  if (n === null || n === undefined) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// --- DexScreener ---
// cgPrice: if provided, filters pairs to those within 20% of that price
async function getDexData(query, cgPrice = null) {
  const isEVMAddress = /^0x[0-9a-fA-F]{40}$/.test(query);
  const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query);

  let url;
  if (isEVMAddress || isSolanaAddress) {
    url = `https://api.dexscreener.com/latest/dex/tokens/${query}`;
  } else {
    url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
  }

  const res = await axios.get(url, { timeout: 10000 });
  const pairs = res.data?.pairs;
  if (!pairs || pairs.length === 0) return null;

  // Filter: must have price and some liquidity
  let valid = pairs.filter((p) => p.priceUsd && (p.liquidity?.usd || 0) > 0);
  if (valid.length === 0) return null;

  // If we have a CoinGecko price, filter to pairs within 20% of it
  // This prevents picking wrong chains (e.g. wrapped BTC on Solana instead of real BTC)
  if (cgPrice) {
    const matched = valid.filter((p) => {
      const ratio = parseFloat(p.priceUsd) / cgPrice;
      return ratio >= 0.8 && ratio <= 1.2;
    });
    if (matched.length > 0) valid = matched;
  }

  // Sort by liquidity (best = most liquid pair)
  valid.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const best = valid[0];

  return {
    symbol: best.baseToken?.symbol,
    name: best.baseToken?.name,
    address: best.baseToken?.address,
    chainId: best.chainId,
    dexId: best.dexId,
    priceUsd: parseFloat(best.priceUsd),
    priceChange: {
      m5: best.priceChange?.m5 ?? null,
      h1: best.priceChange?.h1 ?? null,
      h6: best.priceChange?.h6 ?? null,
      h24: best.priceChange?.h24 ?? null,
    },
    volume24h: best.volume?.h24 || 0,
    volume1h: best.volume?.h1 || 0,
    liquidity: best.liquidity?.usd || 0,
    marketCap: best.marketCap || best.fdv || 0,
    dexUrl: best.url,
    pairCreatedAt: best.pairCreatedAt || null,
  };
}

// --- CoinGecko: find coin ID by symbol ---
async function findCoinGeckoId(symbol) {
  try {
    const headers = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};
    const res = await axios.get(`${CG_BASE}/search`, {
      params: { query: symbol },
      headers,
      timeout: 8000,
    });

    const coins = res.data?.coins || [];
    if (coins.length === 0) return null;

    // Prefer exact symbol match
    const exact = coins.find((c) => c.symbol?.toLowerCase() === symbol.toLowerCase());
    return exact ? exact.id : coins[0].id;
  } catch {
    return null;
  }
}

// --- CoinGecko: current market data (accurate price, volume, mcap) ---
async function getCoinGeckoMarketData(coinId) {
  try {
    const headers = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};
    const res = await axios.get(`${CG_BASE}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        ids: coinId,
        price_change_percentage: '1h,24h,7d',
      },
      headers,
      timeout: 8000,
    });
    const d = res.data?.[0];
    if (!d) return null;
    return {
      priceUsd: d.current_price,
      marketCap: d.market_cap,
      volume24h: d.total_volume,
      priceChange1h: d.price_change_percentage_1h_in_currency ?? null,
      priceChange24h: d.price_change_percentage_24h ?? null,
      priceChange7d: d.price_change_percentage_7d_in_currency ?? null,
      symbol: d.symbol?.toUpperCase(),
      name: d.name,
      image: d.image,
    };
  } catch {
    return null;
  }
}

// --- CoinGecko: 30d daily price history ---
async function getCoinGeckoHistory(coinId) {
  try {
    const headers = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};
    const res = await axios.get(`${CG_BASE}/coins/${coinId}/market_chart`, {
      params: { vs_currency: 'usd', days: 30, interval: 'daily' },
      headers,
      timeout: 10000,
    });
    return res.data?.prices?.map((p) => p[1]) || [];
  } catch {
    return [];
  }
}

// --- Support/Resistance from price history ---
// Uses percentile positions of sorted price array
function findPriceLevels(prices) {
  if (prices.length < 7) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    support2: sorted[0],                              // absolute low
    support1: sorted[Math.floor(n * 0.20)],           // 20th percentile
    midpoint: sorted[Math.floor(n * 0.50)],           // median
    resistance1: sorted[Math.floor(n * 0.80)],        // 80th percentile
    resistance2: sorted[n - 1],                       // absolute high
  };
}

// --- Trade Zones: entry / DCA / TP / SL ---
function calcTradeZones(currentPrice, levels) {
  if (levels && levels.support1 < currentPrice && levels.support2 < currentPrice) {
    const s1 = levels.support1;
    const s2 = levels.support2;
    const r1 = levels.resistance1 > currentPrice ? levels.resistance1 : currentPrice * 1.15;
    const r2 = levels.resistance2 > currentPrice ? levels.resistance2 : currentPrice * 1.40;

    return {
      entryAggressive: currentPrice,
      entrySafe: s1 * 0.99,
      dca1: Math.min(s1 * 0.96, currentPrice * 0.90),
      dca2: Math.min(s1 * 0.90, currentPrice * 0.82),
      dca3: Math.min(s2 * 1.01, currentPrice * 0.72),
      tp1: r1 * 0.98,
      tp2: r2 * 0.97,
      tp3: r2 * 1.20,
      stopLoss: Math.max(s2 * 0.96, currentPrice * 0.80),
      hasHistory: true,
    };
  }

  // No usable history — rough % estimates
  return {
    entryAggressive: currentPrice,
    entrySafe: currentPrice * 0.95,
    dca1: currentPrice * 0.90,
    dca2: currentPrice * 0.82,
    dca3: currentPrice * 0.72,
    tp1: currentPrice * 1.15,
    tp2: currentPrice * 1.35,
    tp3: currentPrice * 1.60,
    stopLoss: currentPrice * 0.85,
    hasHistory: false,
  };
}

// --- Tradability Score 0–10 ---
function calcTradabilityScore(dexData, manipScore, rsi) {
  let score = 0;
  const reasons = [];

  // 1. Liquidity (0–3)
  const liq = dexData.liquidity;
  if (liq >= 1_000_000) {
    score += 3;
    reasons.push(`Deep liquidity (${formatUSD(liq)})`);
  } else if (liq >= 500_000) {
    score += 2;
    reasons.push(`Good liquidity (${formatUSD(liq)})`);
  } else if (liq >= 100_000) {
    score += 1;
    reasons.push(`Thin liquidity (${formatUSD(liq)}) — slippage risk`);
  } else {
    reasons.push(`Very thin liquidity (${formatUSD(liq)}) — dangerous`);
  }

  // 2. Volume health (0–3) — vol/mcap ratio
  const volMcap = dexData.marketCap > 0 ? (dexData.volume24h / dexData.marketCap) * 100 : 0;
  if (volMcap >= 5) {
    score += 3;
    reasons.push(`Strong volume activity (${volMcap.toFixed(1)}% vol/mcap)`);
  } else if (volMcap >= 2) {
    score += 2;
    reasons.push(`Decent volume (${volMcap.toFixed(1)}% vol/mcap)`);
  } else if (volMcap >= 0.5) {
    score += 1;
    reasons.push(`Weak volume (${volMcap.toFixed(1)}% vol/mcap)`);
  } else {
    reasons.push(`Dead volume (${volMcap.toFixed(1)}% vol/mcap) — low interest`);
  }

  // 3. Safety (0–2)
  if (manipScore !== null && manipScore !== undefined) {
    if (manipScore <= 20) {
      score += 2;
      reasons.push('Low manipulation risk');
    } else if (manipScore <= 40) {
      score += 1;
      reasons.push('Moderate manipulation risk');
    } else {
      reasons.push('High manipulation risk — be careful');
    }
  } else {
    score += 1;
    reasons.push('Manipulation risk unknown');
  }

  // 4. Momentum (0–2)
  if (rsi !== null && rsi !== undefined) {
    if (rsi >= 35 && rsi <= 60) {
      score += 2;
      reasons.push(`RSI ${rsi.toFixed(0)} — healthy range`);
    } else if (rsi < 35 && rsi >= 25) {
      score += 2;
      reasons.push(`RSI ${rsi.toFixed(0)} — oversold, potential bounce entry`);
    } else if (rsi < 25) {
      score += 1;
      reasons.push(`RSI ${rsi.toFixed(0)} — extreme oversold, high risk/reward`);
    } else if (rsi > 60 && rsi <= 75) {
      score += 1;
      reasons.push(`RSI ${rsi.toFixed(0)} — getting overbought`);
    } else {
      reasons.push(`RSI ${rsi.toFixed(0)} — extremely overbought, avoid chasing`);
    }
  } else {
    // Proxy: use 24h price change
    const ch = dexData.priceChange.h24;
    if (ch !== null && ch >= -5 && ch <= 15) {
      score += 2;
      reasons.push('Price action in healthy range');
    } else if (ch !== null && ((ch > 15 && ch <= 30) || (ch < -5 && ch >= -20))) {
      score += 1;
      reasons.push('Price action slightly extended');
    } else {
      reasons.push('Extreme price move — momentum unreliable');
    }
  }

  const label =
    score >= 8 ? 'STRONG BUY 🟢' :
    score >= 6 ? 'WATCHLIST 🟡' :
    score >= 4 ? 'RISKY ⚠️' :
    'AVOID 🔴';

  return { score, label, reasons };
}

// --- Volume trend ---
function getVolumeTrend(dexData) {
  const h1 = dexData.volume1h;
  const h24avg = dexData.volume24h / 24;
  if (!h1 || !h24avg || h24avg === 0) return null;
  const ratio = h1 / h24avg;
  if (ratio > 1.5) return `📈 Rising (last 1h is ${ratio.toFixed(1)}x the daily avg)`;
  if (ratio < 0.5) return `📉 Declining (last 1h below daily avg)`;
  return `➡️  Stable`;
}

// --- Main export ---
async function analyzeToken(query) {
  const q = query.trim();

  // 1. CoinGecko first — gets accurate price + market data
  let cgId = null;
  let cgMarket = null;
  let rsi = null;
  let levels = null;

  try {
    cgId = await findCoinGeckoId(q);
    if (cgId) {
      // Run market data + history in parallel
      const [market, prices] = await Promise.all([
        getCoinGeckoMarketData(cgId),
        getCoinGeckoHistory(cgId),
      ]);
      cgMarket = market;
      if (prices.length >= 15) {
        rsi = calculateRSI(prices);
        levels = findPriceLevels(prices);
      }
    }
  } catch {
    // Continue without CoinGecko
  }

  // 2. DexScreener — pass CoinGecko price to filter to the correct chain/pair
  const cgPrice = cgMarket?.priceUsd || null;
  let dexData = null;
  try {
    dexData = await getDexData(q, cgPrice);
  } catch {
    // Continue without DexScreener
  }

  // Need at least one data source
  if (!dexData && !cgMarket) {
    return { error: `Token "${query}" not found. Try the contract address instead.` };
  }

  // 3. Merge: CoinGecko is source of truth for price/mcap/volume
  //    DexScreener adds liquidity, pair URL, and 5m/6h price changes
  const symbol = cgMarket?.symbol || dexData?.symbol;
  const name = cgMarket?.name || dexData?.name;
  const priceUsd = cgMarket?.priceUsd || dexData?.priceUsd;
  const marketCap = cgMarket?.marketCap || dexData?.marketCap || 0;
  const volume24h = cgMarket?.volume24h || dexData?.volume24h || 0;

  // Price changes: CoinGecko for 1h/24h (accurate), DexScreener for 5m/6h
  const priceChange = {
    m5:  dexData?.priceChange?.m5 ?? null,
    h1:  cgMarket?.priceChange1h ?? dexData?.priceChange?.h1 ?? null,
    h6:  dexData?.priceChange?.h6 ?? null,
    h24: cgMarket?.priceChange24h ?? dexData?.priceChange?.h24 ?? null,
  };

  const liquidity = dexData?.liquidity || 0;
  const dexForScore = {
    liquidity,
    volume24h,
    marketCap,
    priceChange,
    volume1h: dexData?.volume1h || 0,
  };

  // 4. Manipulation score
  let manipulation = null;
  try {
    manipulation = await getManipulationScore(symbol, priceUsd);
  } catch {
    // Continue without
  }

  // 5. Calculate zones + score
  const zones = calcTradeZones(priceUsd, levels);
  const tradability = calcTradabilityScore(dexForScore, manipulation?.score ?? null, rsi);
  const volumeTrend = getVolumeTrend(dexForScore);
  const volMcapRatio = marketCap > 0 ? (volume24h / marketCap) * 100 : 0;

  return {
    symbol,
    name,
    address: dexData?.address || null,
    chainId: dexData?.chainId || null,
    dexId: dexData?.dexId || null,
    dexUrl: dexData?.dexUrl || null,
    cgId,
    priceUsd,
    priceChange,
    volume24h,
    liquidity,
    marketCap,
    rsi,
    levels,
    zones,
    manipulation,
    tradability,
    volumeTrend,
    volMcapRatio,
  };
}

module.exports = { analyzeToken, formatPrice, formatUSD, pctStr };
