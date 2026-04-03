const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Stock universe for new pick candidates ───────────────────────────────────
const STOCK_UNIVERSE = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','BRK.B','JPM','V',
  'UNH','XOM','JNJ','PG','MA','HD','CVX','MRK','ABBV','PEP',
  'KO','AVGO','COST','WMT','MCD','BAC','CRM','ACN','LIN','TMO',
  'NFLX','ADBE','AMD','QCOM','TXN','INTC','GS','MS','BLK','SCHW',
  'BA','LMT','RTX','NOC','GD','CAT','DE','UPS','FDX','DIS',
];

// ─── Get user context ─────────────────────────────────────────────────────────
async function getUserContext(userId) {
  const holdingsRes = await pool.query(
    `SELECT DISTINCT h.ticker FROM "Holding" h
     JOIN "BrokerConnection" bc ON bc.id = h."brokerConnectionId"
     WHERE bc."userId" = $1`,
    [userId]
  );

  const watchlistRes = await pool.query(
    `SELECT DISTINCT ticker FROM "WatchlistItem" WHERE "userId" = $1`,
    [userId]
  );

  const signalRes = await pool.query(
    `SELECT ticker, "compositeScore", label FROM "SignalScore" WHERE "userId" = $1`,
    [userId]
  );

  const sectorRes = await pool.query(
    `SELECT sm.sector, SUM(h.quantity * sm.market_cap) as exposure
     FROM "Holding" h
     JOIN "BrokerConnection" bc ON bc.id = h."brokerConnectionId"
     JOIN security_metadata sm ON sm.ticker = h.ticker
     WHERE bc."userId" = $1
     GROUP BY sm.sector`,
    [userId]
  );

    const polyRes = await pool.query(
    `SELECT DISTINCT ticker FROM "PolymarketEventMapping"`
  );

  return {
    holdingTickers: holdingsRes.rows.map(r => r.ticker),
    watchlistTickers: watchlistRes.rows.map(r => r.ticker),
    signals: signalRes.rows,
    sectorExposure: sectorRes.rows,
    polymarketTickers: polyRes.rows.map(r => r.ticker),
  };
}

// ─── Call Claude for recommendations ─────────────────────────────────────────
async function callClaudeForRecommendations(context, candidateTickers) {
  const prompt = `You are a portfolio advisor AI. Based on the user's portfolio context below, generate stock recommendations.

PORTFOLIO CONTEXT:
- Current holdings: ${context.holdingTickers.join(', ') || 'None'}
- Watchlist: ${context.watchlistTickers.join(', ') || 'None'}
- Sector exposure: ${context.sectorExposure.map(s => `${s.sector}`).join(', ') || 'Unknown'}
- Signal scores (composite 0-100, higher=more bullish):
${context.signals.map(s => `  ${s.ticker}: ${s.compositeScore} (${s.label})`).join('\n') || '  None yet'}

CANDIDATE TICKERS FOR NEW PICKS (from these only):
${candidateTickers.join(', ')}

TASK:
Return a JSON array of up to 6 recommendations. Each must have:
- "ticker": string (must be from candidate list for new picks, or from holdings for add-more)
- "recType": "new_pick" | "add_more"
- "reasoning": string (2-3 sentences explaining why, referencing portfolio gaps or signal data)
- "label": "bullish" | "neutral" | "bearish"

Rules:
- "new_pick": stocks NOT in holdings that fill a portfolio gap or have strong signals
- "add_more": stocks already in holdings worth increasing position in
- Be specific in reasoning — mention sector gaps, signal strength, or portfolio balance
- Return ONLY valid JSON array, no markdown, no explanation`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '[]';

  try {
    return JSON.parse(text);
  } catch (_) {
    console.error('[Recommendations] Failed to parse Claude response:', text);
    return [];
  }
}

// ─── Main recommendation runner ───────────────────────────────────────────────
async function runRecommendationEngine(userId) {
  console.log(`[Recommendations] Running for user ${userId}...`);

  const context = await getUserContext(userId);

  // Candidates = universe minus what user already holds
  const holdingSet = new Set(context.holdingTickers.map(t => t.toUpperCase()));
  const combinedUniverse = [...new Set([
    ...STOCK_UNIVERSE,
    ...context.polymarketTickers,
  ])];

  const candidateTickers = combinedUniverse.filter(t => !holdingSet.has(t));

  // Also factor in bullish signal scores
  const bullishSignals = context.signals
    .filter(s => parseFloat(s.compositeScore) >= 60)
    .map(s => s.ticker);

  const recommendations = await callClaudeForRecommendations(context, candidateTickers);

  if (!recommendations.length) {
    console.log('[Recommendations] No recommendations returned');
    return;
  }

  // Upsert recommendations
  for (const rec of recommendations) {
    const signal = context.signals.find(s => s.ticker === rec.ticker);
    await pool.query(
      `INSERT INTO "StockRecommendation"
         ("userId", ticker, "recType", reasoning, "signalScore", label, "isNew", "computedAt")
       VALUES ($1,$2,$3,$4,$5,$6,true,NOW())
       ON CONFLICT ("userId", ticker) DO UPDATE SET
         "recType"=$3, reasoning=$4, "signalScore"=$5, label=$6, "isNew"=true, "computedAt"=NOW()`,
      [userId, rec.ticker, rec.recType, rec.reasoning,
       signal?.compositeScore || null, rec.label || 'neutral']
    );
  }

  console.log(`[Recommendations] Saved ${recommendations.length} recommendations`);
}

// ─── Run for all users ────────────────────────────────────────────────────────
async function runRecommendationsForAllUsers() {
  console.log('[Recommendations] Starting for all users...');
  const usersRes = await pool.query(`SELECT DISTINCT "userId" FROM "SignalScore"`);
  for (const row of usersRes.rows) {
    try {
      await runRecommendationEngine(row.userId);
    } catch (err) {
      console.error(`[Recommendations] Error for user ${row.userId}:`, err.message);
    }
  }
  console.log('[Recommendations] Done');
}

// ─── Get recommendations for a user ──────────────────────────────────────────
async function getUserRecommendations(userId) {
  const res = await pool.query(
    `SELECT * FROM "StockRecommendation"
     WHERE "userId" = $1
     ORDER BY "recType" ASC, "signalScore" DESC NULLS LAST`,
    [userId]
  );
  return res.rows;
}

module.exports = { runRecommendationsForAllUsers, runRecommendationEngine, getUserRecommendations };