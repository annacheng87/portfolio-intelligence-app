const { Pool } = require('pg');
const { detectProbabilityShifts } = require('./polymarketService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function generateAlertsForShift(shift) {
  const tickers = await pool.query(
    `SELECT DISTINCT ticker FROM "PolymarketEventMapping" WHERE "eventId" = $1`,
    [shift.eventId]
  );

  if (tickers.rows.length === 0) return;

  const tickerList = tickers.rows.map(r => r.ticker);

  // Find users who hold or watch these tickers
  const holdingUsersRes = await pool.query(
    `SELECT DISTINCT bc."userId" as user_id FROM "Holding" h
     JOIN "BrokerConnection" bc ON bc.id = h."brokerConnectionId"
     WHERE h.ticker = ANY($1)`,
    [tickerList]
  );

  const watchlistUsersRes = await pool.query(
    `SELECT DISTINCT "userId" as user_id FROM "WatchlistItem"
     WHERE ticker = ANY($1)`,
    [tickerList]
  );

  const userIds = new Set([
    ...holdingUsersRes.rows.map(r => r.user_id),
    ...watchlistUsersRes.rows.map(r => r.user_id),
  ]);

  if (userIds.size === 0) return;

  const direction = shift.shift > 0 ? 'up' : 'down';
  const pct = Math.abs(shift.shift * 100).toFixed(1);
  const message = `"${shift.question}" probability moved ${direction} ${pct}% on Polymarket.`;

  for (const userId of userIds) {
    // Find which of their tickers match
    const userTickerRes = await pool.query(
      `SELECT DISTINCT h.ticker FROM "Holding" h
       JOIN "BrokerConnection" bc ON bc.id = h."brokerConnectionId"
       WHERE bc."userId" = $1 AND h.ticker = ANY($2)
       UNION
       SELECT DISTINCT ticker FROM "WatchlistItem"
       WHERE "userId" = $1 AND ticker = ANY($2)`,
      [userId, tickerList]
    );

    for (const row of userTickerRes.rows) {
      await pool.query(
        `INSERT INTO "PolymarketAlert" ("userId", "marketId", ticker, "alertType", message, "shiftMagnitude", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, shift.marketId, row.ticker, 'probability_shift', message, Math.abs(shift.shift)]
      );
    }
  }
}

async function runAlertPipeline() {
  console.log('[AlertPipeline] Detecting probability shifts...');
  const shifts = await detectProbabilityShifts(0.05);
  console.log(`[AlertPipeline] Found ${shifts.length} shifts`);

  for (const shift of shifts) {
    await generateAlertsForShift(shift);
  }

  console.log('[AlertPipeline] Done');
}

async function getUserAlerts(userId) {
  const res = await pool.query(
    `SELECT * FROM "PolymarketAlert"
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 50`,
    [userId]
  );
  return res.rows;
}

module.exports = { runAlertPipeline, getUserAlerts };