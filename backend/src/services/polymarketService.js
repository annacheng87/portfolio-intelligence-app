const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

async function syncEvents() {
  console.log('[Polymarket] Starting event sync...');

  const res = await fetch(`${POLYMARKET_API}/events?limit=50&active=true&order=volume&ascending=false`);
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);
  const events = await res.json();

  console.log(`[Polymarket] Fetched ${events.length} events`);

  for (const event of events) {
    // Upsert event
    await pool.query(
  `INSERT INTO "PolymarketEvent" (id, title, category, slug, "endDate", "syncedAt")
   VALUES ($1, $2, $3, $4, $5, NOW())
   ON CONFLICT (id) DO UPDATE SET title=$2, category=$3, slug=$4, "endDate"=$5, "syncedAt"=NOW()`,
  [event.id, event.title, event.category || null, event.slug || null, event.endDate || null]
);

    const markets = event.markets || [];
    for (const market of markets) {
      let currentYesProb = null;
      try {
        const prices = JSON.parse(market.outcomePrices || '[]');
        currentYesProb = prices[0] ? parseFloat(prices[0]) : null;
      } catch (_) {}

      // Save previous prob before updating
      const existing = await pool.query(
        `SELECT "currentYesProb" FROM "PolymarketMarket" WHERE id=$1`,
        [market.id]
      );
      const previousYesProb = existing.rows[0]?.currentYesProb ?? null;

      await pool.query(
        `INSERT INTO "PolymarketMarket" (id, "eventId", question, "currentYesProb", "previousYesProb", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
           question=$3,
           "previousYesProb"="PolymarketMarket"."currentYesProb",
           "currentYesProb"=$4,
           "updatedAt"=NOW()`,
        [market.id, event.id, market.question || null, currentYesProb, previousYesProb]
      );
    }
  }

  console.log('[Polymarket] Sync complete');
}

async function detectProbabilityShifts(thresholdPct = 0.05) {
  const res = await pool.query(
    `SELECT id, "eventId", question, "currentYesProb", "previousYesProb"
     FROM "PolymarketMarket"
     WHERE "previousYesProb" IS NOT NULL
       AND "currentYesProb" IS NOT NULL
       AND ABS("currentYesProb" - "previousYesProb") >= $1`,
    [thresholdPct]
  );

  return res.rows.map(row => ({
    marketId: row.id,
    eventId: row.eventId,
    question: row.question,
    currentYesProb: parseFloat(row.currentYesProb),
    previousYesProb: parseFloat(row.previousYesProb),
    shift: parseFloat(row.currentYesProb) - parseFloat(row.previousYesProb),
  }));
}

module.exports = { syncEvents, detectProbabilityShifts };