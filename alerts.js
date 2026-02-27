// In-memory storage for price alerts and watchlist
// Resets on restart — acceptable for quick wins (no DB needed)

const priceAlerts = new Map();     // chatId -> [{query, targetPrice, direction}]
const watchlists = new Map();      // chatId -> [{query, addedAt}]
const watchLastAlerted = new Map();// `${chatId}:${query}` -> timestamp (30min cooldown)

// --- Price Alerts ---

function addAlert(chatId, query, targetPrice, direction) {
  if (!priceAlerts.has(chatId)) priceAlerts.set(chatId, []);
  priceAlerts.get(chatId).push({ query, targetPrice, direction });
  return priceAlerts.get(chatId).length;
}

function getAlerts(chatId) {
  return priceAlerts.get(chatId) || [];
}

function removeAlertsAt(chatId, indices) {
  const list = priceAlerts.get(chatId);
  if (!list) return;
  const toRemove = new Set(indices);
  priceAlerts.set(chatId, list.filter((_, i) => !toRemove.has(i)));
}

function clearAllAlerts(chatId) {
  priceAlerts.delete(chatId);
}

function allAlertEntries() {
  return [...priceAlerts.entries()];
}

// --- Watchlist ---

function addWatch(chatId, query) {
  if (!watchlists.has(chatId)) watchlists.set(chatId, []);
  const list = watchlists.get(chatId);
  if (!list.find((w) => w.query.toLowerCase() === query.toLowerCase())) {
    list.push({ query, addedAt: Date.now() });
    return true;
  }
  return false;
}

function removeWatch(chatId, query) {
  if (!watchlists.has(chatId)) return false;
  const before = watchlists.get(chatId).length;
  watchlists.set(chatId, watchlists.get(chatId).filter(
    (w) => w.query.toLowerCase() !== query.toLowerCase()
  ));
  return watchlists.get(chatId).length < before;
}

function getWatchlist(chatId) {
  return watchlists.get(chatId) || [];
}

function allWatchEntries() {
  return [...watchlists.entries()];
}

// Returns true if we're allowed to fire another watchlist alert for this token
// (30-minute cooldown per token per chat to avoid spam)
function canAlertWatch(chatId, query, cooldownMs = 30 * 60 * 1000) {
  const key = `${chatId}:${query.toLowerCase()}`;
  const last = watchLastAlerted.get(key) || 0;
  if (Date.now() - last > cooldownMs) {
    watchLastAlerted.set(key, Date.now());
    return true;
  }
  return false;
}

module.exports = {
  addAlert, getAlerts, removeAlertsAt, clearAllAlerts, allAlertEntries,
  addWatch, removeWatch, getWatchlist, allWatchEntries, canAlertWatch,
};
