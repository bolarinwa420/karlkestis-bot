// Token Launch Scoring Engine
// Inputs: token parameters → Outputs: grade, score, predictions, flags

const HOT_NARRATIVES = ['ai', 'depin', 'rwa', 'btc_fi'];
const COLD_NARRATIVES = ['nft', 'metaverse', 'play2earn'];

function scoreToken(p) {
  let score = 50; // neutral baseline
  const flags = [];
  const positives = [];

  // ─── S TIER: Market macro ───────────────────────────────────────────────
  if (p.macro === 'bull')         { score += 20; positives.push('Bull market at TGE — rising tide lifts all boats'); }
  else if (p.macro === 'bear')    { score -= 20; flags.push('Bear market at TGE — strongest single headwind'); }

  // ─── S TIER: Circulating supply % ───────────────────────────────────────
  const circ = parseFloat(p.circ_supply_pct) || 0;
  if (circ >= 40)      { score += 15; positives.push(`${circ}% circulating at launch — low future sell pressure`); }
  else if (circ >= 20) { score += 5; }
  else if (circ < 10)  { score -= 15; flags.push(`Only ${circ}% circulating — ${100 - circ}% future unlock overhang`); }
  else                 { score -= 5; }

  // ─── S TIER: Unlock schedule ─────────────────────────────────────────────
  if (p.unlock_type === '100pct')        { score -= 15; flags.push('100% unlock at TGE — maximum day 1 sell pressure'); }
  else if (p.unlock_type === 'cliff_linear') { score += 12; positives.push('Cliff + linear vesting — controlled supply release'); }
  else if (p.unlock_type === 'linear')   { score += 6; }
  else if (p.unlock_type === 'vested')   { score += 3; }

  // ─── A TIER: VC quality ──────────────────────────────────────────────────
  if (p.vc_tier === 'tier1')           { score += 15; positives.push('Tier 1 VC (a16z / Paradigm / Sequoia) — reputational floor'); }
  else if (p.vc_tier === 'binance_labs') { score += 12; positives.push('Binance Labs involved — listing near guaranteed'); }
  else if (p.vc_tier === 'mid')        { score += 5; }
  else if (p.vc_tier === 'dwf')        { score -= 10; flags.push('DWF Labs — market maker AND holder, conflict of interest'); }
  else if (p.vc_tier === 'unknown')    { score -= 5; flags.push('Unknown / unverifiable VCs — no reputational skin in game'); }
  else if (p.vc_tier === 'none')       { score -= 8; flags.push('No VC backing — no institutional support post-launch'); }

  // ─── A TIER: CEX listing ─────────────────────────────────────────────────
  if (p.cex_tier === 'binance_day1')   { score += 15; positives.push('Binance Day 1 listing — maximum retail distribution'); }
  else if (p.cex_tier === 'bybit')     { score += 10; positives.push('Bybit listing — strong reach'); }
  else if (p.cex_tier === 'gate_kucoin') { score += 5; }
  else if (p.cex_tier === 'dex_only')  { score -= 5; flags.push('DEX only — limited retail access, higher friction'); }

  // ─── A TIER: Narrative fit ───────────────────────────────────────────────
  if (HOT_NARRATIVES.includes(p.narrative))  { score += 15; positives.push(`Hot narrative: ${p.narrative.toUpperCase()} — sector has active capital`); }
  else if (COLD_NARRATIVES.includes(p.narrative)) { score -= 10; flags.push(`Cold narrative: ${p.narrative} — sector interest is low`); }
  else { score += 5; }

  // ─── A TIER: Binance Alpha ───────────────────────────────────────────────
  const baPct = parseFloat(p.ba_allocation_pct) || 0;
  if (p.binance_alpha === 'yes' && baPct <= 2)  { score += 10; positives.push(`Binance Alpha: ${baPct}% allocation — low, project had leverage`); }
  else if (p.binance_alpha === 'yes' && baPct > 3) { score += 3; flags.push(`Binance Alpha: ${baPct}% allocation — high, crime pump / dump cycle risk`); }
  else if (p.binance_alpha === 'yes')            { score += 6; }

  // ─── B TIER: Fundraise amount ────────────────────────────────────────────
  const raise = parseFloat(p.raise_amount_m) || 0;
  if (raise >= 50)      { score += 5; }
  else if (raise >= 20) { score += 8; positives.push(`$${raise}M raise — strong pre-launch institutional conviction`); }
  else if (raise >= 5)  { score += 5; }
  else if (raise === 0) { score -= 3; flags.push('No disclosed funding raise'); }

  // ─── B TIER: InfoFi / mindshare ──────────────────────────────────────────
  if (p.infofi === 'strong')   { score += 8; positives.push('Strong Kaito / Wallchain mindshare — organic CT attention'); }
  else if (p.infofi === 'moderate') { score += 4; }

  // ─── B TIER: FUD at TGE ──────────────────────────────────────────────────
  if (p.fud_level === 'major') { score -= 15; flags.push('Major FUD at TGE — trust damage compounds over 90 days'); }
  else if (p.fud_level === 'minor') { score -= 5; flags.push('Minor FUD at TGE — some trust damage'); }

  // ─── B TIER: Launch liquidity ────────────────────────────────────────────
  const liq = parseFloat(p.launch_liquidity_m) || 0;
  if (liq >= 5)     { score += 8; positives.push(`$${liq}M DEX liquidity — price stability at launch`); }
  else if (liq >= 1) { score += 5; }
  else if (liq > 0)  { score -= 5; flags.push(`Only $${liq}M liquidity — expect violent candles`); }

  // ─── AIRDROP TYPE ────────────────────────────────────────────────────────
  if (p.airdrop_type === 'points_farm') { score -= 10; flags.push('Points farming airdrop — mercenary capital exits day 1'); }
  else if (p.airdrop_type === 'qualified') { score += 5; positives.push('Qualified user airdrop — stickier holder base'); }

  // ─── TEAM ────────────────────────────────────────────────────────────────
  if (p.team === 'doxxed_track_record') { score += 8; positives.push('Doxxed team with track record — accountability floor exists'); }
  else if (p.team === 'doxxed')  { score += 3; }
  else if (p.team === 'anon')    { score -= 5; flags.push('Anonymous team — no accountability if things go wrong'); }

  // ─── AUDIT ───────────────────────────────────────────────────────────────
  if (p.audited === 'yes')  { score += 5; positives.push('Smart contract audited'); }
  else                      { score -= 5; flags.push('No smart contract audit'); }

  // ─── LP LOCKED ───────────────────────────────────────────────────────────
  if (p.lp_locked === 'yes') { score += 5; }
  else { score -= 10; flags.push('LP not locked — rug pull remains possible'); }

  score = Math.round(Math.max(0, Math.min(100, score)));

  return {
    score,
    grade: getGrade(score),
    predictions: getPredictions(score, p),
    flags,
    positives,
  };
}

function getGrade(score) {
  if (score >= 80) return { letter: 'S', label: 'Very likely to perform', color: '#00e676' };
  if (score >= 65) return { letter: 'A', label: 'Likely to perform',      color: '#40c4ff' };
  if (score >= 50) return { letter: 'B', label: 'Slight edge',             color: '#ffee58' };
  if (score >= 35) return { letter: 'C', label: 'Uncertain',               color: '#ffa726' };
  return                  { letter: 'D', label: 'Likely to underperform',  color: '#ef5350' };
}

function getPredictions(score, p) {
  // TGE (first 24h) — driven by hype: CEX, macro, narrative, BA
  const hype =
    (p.macro === 'bull' ? 25 : p.macro === 'bear' ? -25 : 0) +
    (p.cex_tier === 'binance_day1' ? 20 : p.cex_tier === 'bybit' ? 10 : 0) +
    (HOT_NARRATIVES.includes(p.narrative) ? 15 : COLD_NARRATIVES.includes(p.narrative) ? -10 : 0) +
    (p.binance_alpha === 'yes' ? 10 : 0) +
    (p.infofi === 'strong' ? 8 : p.infofi === 'moderate' ? 4 : 0);

  let tge;
  if (hype >= 45)      tge = { label: '🚀 Strong pump',         range: '+50% to +300%' };
  else if (hype >= 20) tge = { label: '📈 Moderate pump',       range: '+15% to +80%' };
  else if (hype >= 0)  tge = { label: '➡️ Flat / mild move',   range: '-10% to +30%' };
  else                 tge = { label: '📉 Likely dump',          range: '-20% to -60%' };

  // 30d — driven by unlock pressure + macro
  const unlockPressure =
    (p.unlock_type === '100pct' ? -30 : p.unlock_type === 'cliff_linear' ? 10 : 0) +
    (circ(p) < 15 ? -15 : 0) +
    (p.macro === 'bear' ? -15 : p.macro === 'bull' ? 10 : 0) +
    (p.airdrop_type === 'points_farm' ? -10 : 0);

  let tge30;
  if (unlockPressure >= 10)       tge30 = { label: '📈 Above TGE price', range: '+10% to +60%' };
  else if (unlockPressure >= -10) tge30 = { label: '➡️ Near TGE price', range: '-25% to +20%' };
  else                            tge30 = { label: '📉 Below TGE price', range: '-30% to -65%' };

  // 90d — driven by fundamentals score
  let tge90;
  if (score >= 75)      tge90 = { label: '📈 Above TGE price', range: '+20% to +150%' };
  else if (score >= 55) tge90 = { label: '➡️ Near TGE price', range: '-25% to +40%' };
  else                  tge90 = { label: '📉 Below TGE price', range: '-40% to -85%' };

  return { tge, tge30, tge90 };
}

function circ(p) {
  return parseFloat(p.circ_supply_pct) || 0;
}

module.exports = { scoreToken };
