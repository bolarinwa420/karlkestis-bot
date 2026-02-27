const axios = require('axios');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GoPlus chain ID mapping
const CHAIN_MAP = {
  ethereum: '1',
  bsc: '56',
  'binance-smart-chain': '56',
  polygon: '137',
  arbitrum: '42161',
  avalanche: '43114',
  optimism: '10',
  base: '8453',
  cronos: '25',
  fantom: '250',
};

// --- DexScreener ---
// Searches by symbol, picks the pair with highest liquidity
// Cross-checks price against CoinGecko price to avoid returning wrong token
async function getDexData(symbol, cgPrice) {
  try {
    const res = await axios.get('https://api.dexscreener.com/latest/dex/search', {
      params: { q: symbol },
      timeout: 8000,
    });

    const pairs = res.data?.pairs;
    if (!pairs || pairs.length === 0) return null;

    // Filter to pairs where price is within 20% of CoinGecko price (avoids fake tokens)
    const priceMatched = pairs.filter((p) => {
      if (!p.priceUsd || !cgPrice) return true;
      const ratio = parseFloat(p.priceUsd) / cgPrice;
      return ratio >= 0.8 && ratio <= 1.2;
    });

    const pool = priceMatched.length > 0 ? priceMatched : pairs;

    // Pick pair with highest liquidity
    const sorted = pool
      .filter((p) => p.liquidity?.usd > 0)
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

    if (sorted.length === 0) return null;

    const top = sorted[0];
    return {
      contractAddress: top.baseToken?.address,
      chainId: top.chainId,
      liquidity: top.liquidity?.usd || 0,
      volume24h: top.volume?.h24 || 0,
      dexUrl: top.url,
    };
  } catch {
    return null;
  }
}

// --- GoPlus Security API ---
async function getGoPlusData(contractAddress, chainId) {
  const gpChainId = CHAIN_MAP[chainId];
  if (!gpChainId) return null; // Solana and unknown chains: skip

  try {
    const res = await axios.get(
      `https://api.gopluslabs.io/api/v1/token_security/${gpChainId}`,
      {
        params: { contract_addresses: contractAddress },
        timeout: 10000,
      }
    );

    const key = contractAddress.toLowerCase();
    return res.data?.result?.[key] || null;
  } catch {
    return null;
  }
}

// --- Scoring ---
// Returns { score: 0-100, flags: string[] }
function calcScore(dexData, gpData) {
  let score = 0;
  const flags = [];

  // Volume / Liquidity ratio (wash trading signal)
  if (dexData) {
    const ratio =
      dexData.liquidity > 0 ? dexData.volume24h / dexData.liquidity : 0;

    if (ratio > 20) {
      score += 20;
      flags.push(`Volume/Liquidity ratio: ${ratio.toFixed(0)}x — wash trading likely`);
    } else if (ratio > 10) {
      score += 10;
      flags.push(`Volume/Liquidity ratio: ${ratio.toFixed(0)}x — elevated`);
    }

    if (dexData.liquidity < 100_000) {
      score += 10;
      flags.push(`Thin liquidity: $${(dexData.liquidity / 1000).toFixed(0)}K — violent moves possible`);
    }
  }

  if (gpData) {
    // Honeypot — override everything
    if (gpData.is_honeypot === '1') {
      return {
        score: 100,
        flags: ['☠️ HONEYPOT — sell function disabled, funds are trapped'],
      };
    }

    // Top 10 holder concentration
    const holders = gpData.holders || [];
    const top10Pct =
      holders
        .slice(0, 10)
        .reduce((sum, h) => sum + parseFloat(h.percent || 0), 0) * 100;

    if (top10Pct > 50) {
      score += 25;
      flags.push(`Top 10 wallets own ${top10Pct.toFixed(1)}% of supply — high exit risk`);
    } else if (top10Pct > 40) {
      score += 15;
      flags.push(`Top 10 wallets own ${top10Pct.toFixed(1)}% of supply — moderate concentration`);
    }

    // LP lock status
    if (gpData.lp_holders && gpData.lp_holders.length > 0) {
      const anyLocked = gpData.lp_holders.some((h) => h.is_locked === 1);
      if (!anyLocked) {
        score += 20;
        flags.push('LP not locked — rug pull possible');
      }
    }

    // Mint function active
    if (gpData.is_mintable === '1') {
      score += 15;
      flags.push('Mint function active — supply can be inflated');
    }

    // Owner can blacklist wallets
    if (gpData.is_blacklisted === '1') {
      score += 10;
      flags.push('Blacklist function active — dev can freeze wallets');
    }

    // Owner can take back ownership
    if (gpData.can_take_back_ownership === '1') {
      score += 10;
      flags.push('Ownership can be reclaimed by deployer');
    }
  }

  return { score: Math.min(score, 100), flags };
}

function getRiskLabel(score) {
  if (score <= 20) return { label: 'Low', emoji: '✅' };
  if (score <= 40) return { label: 'Moderate', emoji: '⚠️' };
  if (score <= 60) return { label: 'High', emoji: '🚨' };
  return { label: 'Very High', emoji: '☠️' };
}

// --- Main export ---
async function getManipulationScore(symbol, cgPrice) {
  const dexData = await getDexData(symbol, cgPrice);
  if (!dexData || !dexData.contractAddress) {
    return {
      score: null,
      flags: [],
      risk: null,
      note: 'Not found on DexScreener',
      suppressed: false,
    };
  }

  await sleep(500);

  const gpData = await getGoPlusData(dexData.contractAddress, dexData.chainId);
  const { score, flags } = calcScore(dexData, gpData);
  const risk = getRiskLabel(score);

  // Only suppress on confirmed honeypot
  const suppressed = score === 100 && flags[0]?.includes('HONEYPOT');

  return { score, flags, risk, dexData, suppressed };
}

module.exports = { getManipulationScore };
