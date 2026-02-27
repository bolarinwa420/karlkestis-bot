require('dotenv').config();

const fs = require('fs');
const { getMarkets, getPriceHistory } = require('./coingecko');
const { calculateRSI } = require('./rsi');
const { sendAlert } = require('./telegram');
const { getSocialMap } = require('./lunarcrush');
const { getManipulationScore } = require('./manipulation');

// --- Config ---
const ATH_DROP_THRESHOLD = -70;        // alert if down 70%+ from ATH
const RSI_THRESHOLD = 35;              // alert if RSI below this
const SOCIAL_SPIKE_MULTIPLIER = 2.0;   // 2x previous scan's volume = spike
const PAGES_TO_SCAN = 2;               // 2 pages x 250 = top 500 tokens
const SCAN_INTERVAL_HOURS = 6;         // how often to re-scan
const API_DELAY_MS = 7000;             // CoinGecko free tier (no key): ~8 req/min safe
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // don't re-alert same token within 24h

const ALERTED_FILE = './alerted.json';
const SOCIAL_BASELINE_FILE = './social_baseline.json';

// --- Helpers ---
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(4);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

// Returns: { spiking: true/false, multiplier, data } or null if no LunarCrush key
function checkSocialSpike(symbol, socialMap, baseline) {
  const key = symbol.toLowerCase();
  const data = socialMap[key];
  if (!data) return null; // token not tracked by LunarCrush

  const prev = baseline[key] || 0;
  const current = data.social_volume_24h;

  // First time seeing this token — store baseline, no spike yet
  if (prev === 0) return { spiking: false, multiplier: null, data };

  const multiplier = prev > 0 ? (current / prev).toFixed(1) : null;
  const spiking = current >= prev * SOCIAL_SPIKE_MULTIPLIER;

  return { spiking, multiplier, data };
}

// --- Main scan ---
async function scan() {
  console.log(`\n[${new Date().toISOString()}] Starting scan...`);

  const alerted = loadJSON(ALERTED_FILE);
  const socialBaseline = loadJSON(SOCIAL_BASELINE_FILE);
  const now = Date.now();

  // Step 1: Fetch social data (1 LunarCrush call covers all tokens)
  let socialMap = {};
  const hasLunarCrush = !!process.env.LUNARCRUSH_API_KEY;

  if (hasLunarCrush) {
    try {
      socialMap = await getSocialMap();
      console.log(`LunarCrush: loaded social data for ${Object.keys(socialMap).length} coins`);
    } catch (err) {
      console.error(`LunarCrush fetch failed: ${err.message} — falling back to price-only`);
    }
  } else {
    console.log('No LUNARCRUSH_API_KEY set — running price-only mode (Phase 1)');
  }

  // Step 2: Fetch CoinGecko markets, filter by ATH drop
  let candidates = [];
  for (let page = 1; page <= PAGES_TO_SCAN; page++) {
    try {
      const markets = await getMarkets(page);
      const filtered = markets.filter(
        (coin) =>
          coin.ath_change_percentage !== null &&
          coin.ath_change_percentage <= ATH_DROP_THRESHOLD
      );
      candidates.push(...filtered);
      console.log(`  Page ${page}: ${markets.length} coins fetched, ${filtered.length} passed ATH filter`);
    } catch (err) {
      console.error(`  Error fetching page ${page}:`, err.message);
    }
    await sleep(API_DELAY_MS);
  }

  console.log(`\nCandidates (down ${Math.abs(ATH_DROP_THRESHOLD)}%+ from ATH): ${candidates.length}`);

  // Step 3: Check RSI + social for each candidate
  let alertsSent = 0;
  const newBaseline = { ...socialBaseline }; // carry forward existing baseline

  for (const coin of candidates) {
    // Skip if alerted recently
    if (alerted[coin.id] && now - alerted[coin.id] < ALERT_COOLDOWN_MS) continue;

    try {
      const prices = await getPriceHistory(coin.id);
      await sleep(API_DELAY_MS);

      if (prices.length < 15) continue;

      const rsi = calculateRSI(prices);
      const priceSignal = rsi !== null && rsi < RSI_THRESHOLD;

      // Update social baseline for this token (regardless of price signal)
      const sym = coin.symbol.toLowerCase();
      const social = checkSocialSpike(coin.symbol, socialMap, socialBaseline);
      if (social?.data) newBaseline[sym] = social.data.social_volume_24h;

      // Determine if we alert
      let shouldAlert = false;
      let alertReason = '';

      if (hasLunarCrush && Object.keys(socialMap).length > 0) {
        // Phase 2: require BOTH price + social spike
        if (priceSignal && social?.spiking) {
          shouldAlert = true;
          alertReason = `price + social spike (${social.multiplier}x)`;
        }
      } else {
        // Phase 1 fallback: price only
        if (priceSignal) {
          shouldAlert = true;
          alertReason = 'price only (no social key)';
        }
      }

      // Run manipulation check only if alert would fire (saves API calls)
      let manipulation = null;
      if (shouldAlert) {
        try {
          manipulation = await getManipulationScore(coin.symbol, coin.current_price);
          await sleep(500);
        } catch (err) {
          console.error(`  Manipulation check failed for ${coin.symbol}: ${err.message}`);
        }
      }

      // Suppress honeypots entirely
      if (manipulation?.suppressed) {
        shouldAlert = false;
        alertReason = 'suppressed — honeypot detected';
      }

      const manipLabel = manipulation?.score !== null && manipulation?.score !== undefined
        ? `${manipulation.risk.emoji} ${manipulation.score}/100`
        : 'N/A';

      const statusLine = `  ${coin.symbol.toUpperCase().padEnd(10)} | ATH: ${coin.ath_change_percentage.toFixed(1)}% | RSI: ${rsi ?? 'N/A'} | Social: ${social ? (social.spiking ? `SPIKE ${social.multiplier}x` : `flat`) : 'N/A'} | Manip: ${manipLabel}`;

      if (shouldAlert) {
        console.log(`${statusLine} ← 🔔 ALERT (${alertReason})`);

        await sendAlert({
          ...coin,
          rsi,
          current_price: formatPrice(coin.current_price),
          social: social?.data || null,
          socialMultiplier: social?.multiplier || null,
          manipulation,
        });

        alerted[coin.id] = now;
        saveJSON(ALERTED_FILE, alerted);
        alertsSent++;

        await sleep(1000);
      } else {
        console.log(statusLine);
      }
    } catch (err) {
      console.error(`  Error on ${coin.id}:`, err.message);
    }
  }

  // Save updated social baseline
  saveJSON(SOCIAL_BASELINE_FILE, newBaseline);

  console.log(`\nScan done. ${alertsSent} alert(s) sent. Next scan in ${SCAN_INTERVAL_HOURS}h.`);
}

// --- Entry point ---
async function main() {
  const mode = process.env.LUNARCRUSH_API_KEY ? 'Phase 2 (price + social)' : 'Phase 1 (price only)';
  console.log(`Token Revival Scanner started — ${mode}`);
  console.log(`Settings: ATH drop ≤ ${ATH_DROP_THRESHOLD}% | RSI < ${RSI_THRESHOLD} | Social spike ≥ ${SOCIAL_SPIKE_MULTIPLIER}x | Top ${PAGES_TO_SCAN * 250} tokens | Every ${SCAN_INTERVAL_HOURS}h`);

  await scan();
  setInterval(scan, SCAN_INTERVAL_HOURS * 60 * 60 * 1000);
}

main().catch(console.error);
