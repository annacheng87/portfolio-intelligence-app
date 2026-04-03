const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log('[DEBUG] ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'LOADED' : 'MISSING');

async function callClaudeForMapping(eventTitles) {
  const prompt = `You are a financial analyst. Given these prediction market event titles, return a JSON array where each element has:
- "eventId": the event id (string)
- "tickers": array of stock tickers (1-4) most likely affected by this event

Only return tickers for US-listed stocks. If no stocks are clearly affected, return an empty tickers array.
Return ONLY valid JSON, no markdown, no explanation.

Events:
${JSON.stringify(eventTitles)}`;

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
    console.error('[EventMapping] Failed to parse Claude response:', text);
    return [];
  }
}

async function mapAllUnmappedEvents() {
  console.log('[EventMapping] Finding unmapped events...');

  const res = await pool.query(
    `SELECT e.id, e.title FROM "PolymarketEvent" e
     WHERE NOT EXISTS (
       SELECT 1 FROM "PolymarketEventMapping" m WHERE m."eventId" = e.id
     )
     LIMIT 30`
  );

  if (res.rows.length === 0) {
    console.log('[EventMapping] No unmapped events found');
    return;
  }

  console.log(`[EventMapping] Mapping ${res.rows.length} events via Claude...`);

  const eventTitles = res.rows.map(r => ({ eventId: r.id, title: r.title }));
  const mappings = await callClaudeForMapping(eventTitles);

  for (const mapping of mappings) {
    const tickers = mapping.tickers || [];
    for (const ticker of tickers) {
      await pool.query(
        `INSERT INTO "PolymarketEventMapping" ("eventId", ticker, "mappedAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT ("eventId", ticker) DO NOTHING`,
        [mapping.eventId, ticker.toUpperCase()]
      );
    }
  }

  console.log('[EventMapping] Mapping complete');
}

async function getRelevantEventsForUser(userId) {
  // Get user's holdings tickers
  const holdingRows = await pool.query(
    `SELECT DISTINCT h.ticker FROM "Holding" h
     JOIN "BrokerConnection" bc ON bc.id = h."brokerConnectionId"
     WHERE bc."userId" = $1`,
    [userId]
  );

  // Get user's watchlist tickers
  const watchlistRows = await pool.query(
    `SELECT DISTINCT ticker FROM "WatchlistItem" WHERE "userId" = $1`,
    [userId]
  );

  const holdingTickers = new Set(holdingRows.rows.map(r => r.ticker?.toUpperCase()).filter(Boolean));
  const watchlistTickers = new Set(watchlistRows.rows.map(r => r.ticker?.toUpperCase()).filter(Boolean));
  const userTickers = new Set([...holdingTickers, ...watchlistTickers]);

  if (userTickers.size === 0) return [];

  // Find events mapped to those tickers
  const mappingRes = await pool.query(
    `SELECT m."eventId", m.ticker FROM "PolymarketEventMapping" m
     WHERE m.ticker = ANY($1)`,
    [Array.from(userTickers)]
  );

  if (mappingRes.rows.length === 0) return [];

  // Group tickers by eventId
  const eventTickerMap = {};
  for (const row of mappingRes.rows) {
    if (!eventTickerMap[row.eventId]) eventTickerMap[row.eventId] = [];
    eventTickerMap[row.eventId].push(row.ticker);
  }

  const eventIds = Object.keys(eventTickerMap);

  // Fetch full event + market data
  const eventsRes = await pool.query(
    `SELECT e.id, e.title, e.category, e."endDate",
            json_agg(json_build_object(
              'id', mk.id,
              'question', mk.question,
              'currentYesProb', mk."currentYesProb"
            )) as markets
     FROM "PolymarketEvent" e
     JOIN "PolymarketMarket" mk ON mk."eventId" = e.id
     WHERE e.id = ANY($1)
     GROUP BY e.id`,
    [eventIds]
  );

  return eventsRes.rows.map(event => ({
    event,
    matchedTickers: eventTickerMap[event.id] || [],
    isHolding: (eventTickerMap[event.id] || []).some(t => holdingTickers.has(t)),
    isWatchlist: (eventTickerMap[event.id] || []).some(t => watchlistTickers.has(t)),
  }));
}

module.exports = { mapAllUnmappedEvents, getRelevantEventsForUser };