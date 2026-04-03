const { Pool } = require('pg');
const { getSnapshots } = require('./marketData');
const { getTickerSentiment } = require('./newsSentiment');
const { getTickerRedditSentiment } = require('./redditSentiment');
const { normalizeNewsSentiment, normalizeRedditSentiment } = require('./sentimentNormService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Weights (must sum to 1.0) ────────────────────────────────────────────────
const WEIGHTS = {
  price:   0.30,
  volume:  0.15,
  news:    0.25,
  reddit:  0.15,
  poly:    0.15,
};

// ─── Normalize price pct change to 0–100 ─────────────────────────────────────
// -10% → 0, 0% → 50, +10% → 100 (capped)
function normalizePriceScore(pctChange) {
  const clamped = Math.max(-10, Math.min(10, pctChange));
  return Math.round((clamped + 10) / 20 * 100);
}

// ─── Normalize volume multiple to 0–100 ──────────────────────────────────────
// 1x → 50, 3x+ → 100, 0x → 0
function normalizeVolumeScore(volumeMultiple) {
  const clamped = Math.max(0, Math.min(3, volumeMultiple));
  return Math.round((clamped / 3) * 100);
}

// ─── Get Polymarket score for a ticker ───────────────────────────────────────
async function getPolyScore(ticker) {
  const res = await pool.query(
    `SELECT AVG(mk."currentYesProb") as avg_prob
     FROM "PolymarketMarket" mk
     JOIN "PolymarketEventMapping" mp ON mp."eventId" = mk."eventId"
     WHERE mp.ticker = $1 AND mk."currentYesProb" IS NOT NULL`,
    [ticker]
  );
  const prob = parseFloat(res.rows[0]?.avg_prob);
  if (isNaN(prob)) return null;
  return Math.round(prob * 100);
}

// ─── Compute label from composite score ──────────────────────────────────────
function scoreToLabel(score) {
  if (score >= 65) return 'bullish';
  if (score <= 35) return 'bearish';
  return 'neutral';
}

// ─── Compute signal score for one ticker/user ─────────────────────────────────
async function computeSignalForTicker(ticker, userId, snapshot) {
  const price     = snapshot.day?.c || snapshot.lastTrade?.p;
  const open      = snapshot.day?.o;
  const volume    = snapshot.day?.v || 0;
  const avgVolume = snapshot.prevDay?.v || 0;

  const pctChange      = (price && open) ? ((price - open) / open) * 100 : 0;
  const volumeMultiple = avgVolume > 0 ? volume / avgVolume : 1;

  const priceScore  = normalizePriceScore(pctChange);
  const volumeScore = normalizeVolumeScore(volumeMultiple);

  const [newsSentiment, redditSentiment, polyScore] = await Promise.all([
    getTickerSentiment(ticker).catch(() => null),
    getTickerRedditSentiment(ticker).catch(() => null),
    getPolyScore(ticker).catch(() => null),
  ]);

  const newsScore   = newsSentiment
    ? normalizeNewsSentiment({ label: newsSentiment.label, confidence: Math.min(1, Math.abs(newsSentiment.score)) }).score
    : 50;

  const redditScore = redditSentiment
    ? normalizeRedditSentiment({ label: redditSentiment.label, mentionCount: redditSentiment.postCount }).score
    : 50;

  // Composite — use poly weight only if we have poly data
  let compositeScore;
  if (polyScore !== null) {
    compositeScore =
      priceScore  * WEIGHTS.price  +
      volumeScore * WEIGHTS.volume +
      newsScore   * WEIGHTS.news   +
      redditScore * WEIGHTS.reddit +
      polyScore   * WEIGHTS.poly;
  } else {
    // Redistribute poly weight to price and news
    compositeScore =
      priceScore  * (WEIGHTS.price  + 0.08) +
      volumeScore * WEIGHTS.volume +
      newsScore   * (WEIGHTS.news   + 0.07) +
      redditScore * WEIGHTS.reddit;
  }

  compositeScore = Math.round(compositeScore);
  const label = scoreToLabel(compositeScore);

  // Upsert into DB
  await pool.query(
    `INSERT INTO "SignalScore"
       (ticker, "userId", "priceScore", "volumeScore", "newsScore", "redditScore",
        "polyScore", "compositeScore", label, "computedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (ticker, "userId") DO UPDATE SET
       "priceScore"=$3, "volumeScore"=$4, "newsScore"=$5, "redditScore"=$6,
       "polyScore"=$7, "compositeScore"=$8, label=$9, "computedAt"=NOW()`,
    [ticker, userId, priceScore, volumeScore, newsScore, redditScore,
     polyScore, compositeScore, label]
  );

  return { ticker, priceScore, volumeScore, newsScore, redditScore, polyScore, compositeScore, label };
}

// ─── Run fusion for all users ─────────────────────────────────────────────────
async function runSignalFusion() {
  console.log('[SignalFusion] Starting...');

  // Get all user tickers (holdings + watchlist)
  const holdingRes = await pool.query(
    `SELECT DISTINCT bc."userId", h.ticker
     FROM "Holding" h
     JOIN "BrokerConnection" bc ON bc.id = h."brokerConnectionId"`
  );
  const watchlistRes = await pool.query(
    `SELECT DISTINCT "userId", ticker FROM "WatchlistItem"`
  );

  // Build map: { userId: Set<ticker> }
  const userTickerMap = {};
  for (const row of [...holdingRes.rows, ...watchlistRes.rows]) {
    if (!userTickerMap[row.userId]) userTickerMap[row.userId] = new Set();
    userTickerMap[row.userId].add(row.ticker);
  }

  const allTickers = [...new Set([
    ...holdingRes.rows.map(r => r.ticker),
    ...watchlistRes.rows.map(r => r.ticker),
  ])];

  if (allTickers.length === 0) {
    console.log('[SignalFusion] No tickers found');
    return;
  }

  console.log(`[SignalFusion] Computing scores for ${allTickers.length} tickers`);
  const snapshots = await getSnapshots(allTickers);
  await new Promise(r => setTimeout(r, 3000));

  const snapMap = {};
  for (const s of snapshots) snapMap[s.ticker] = s;

 for (const [userId, tickers] of Object.entries(userTickerMap)) {
    for (const ticker of tickers) {
      const snapshot = snapMap[ticker];
      if (!snapshot) continue;
      try {
        await computeSignalForTicker(ticker, userId, snapshot);
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`[SignalFusion] Error for ${ticker}:`, err.message);
      }
    }
  }

  console.log('[SignalFusion] Done');
}

// ─── Get scores for a user ────────────────────────────────────────────────────
async function getUserSignals(userId) {
  const res = await pool.query(
    `SELECT * FROM "SignalScore" WHERE "userId" = $1 ORDER BY "compositeScore" DESC`,
    [userId]
  );
  return res.rows;
}

module.exports = { runSignalFusion, getUserSignals };