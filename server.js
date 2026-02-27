require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { scoreToken } = require('./scorer');

const app = express();
const PORT = process.env.SCORER_PORT || 3001;
const HISTORY_FILE = './scored-tokens.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Score a token
app.post('/api/score', (req, res) => {
  try {
    const params = req.body;
    if (!params.token_name || !params.token_symbol) {
      return res.status(400).json({ success: false, error: 'Token name and symbol are required' });
    }

    const result = scoreToken(params);

    const history = loadHistory();
    history.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      name: params.token_name,
      symbol: params.token_symbol.toUpperCase(),
      tge_date: params.tge_date || null,
      score: result.score,
      grade: result.grade.letter,
      params,
      result,
    });
    saveHistory(history.slice(0, 100));

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get history
app.get('/api/history', (req, res) => {
  res.json(loadHistory());
});

// Delete a history entry
app.delete('/api/history/:id', (req, res) => {
  const history = loadHistory().filter((h) => h.id !== parseInt(req.params.id));
  saveHistory(history);
  res.json({ success: true });
});

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

app.listen(PORT, () => {
  console.log(`\nToken Scorer UI → http://localhost:${PORT}`);
  console.log('Open that URL in your browser.\n');
});
