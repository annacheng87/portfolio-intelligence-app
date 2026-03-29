const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { getSnapshots } = require('./marketData');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const PRICE_MOVE_THRESHOLD = 0.05;
const VOLUME_SPIKE_THRESHOLD = 2.0;

function generateAlertMessage(ticker, type, data) {
  if (type === 'price_up') {
    return {
      plainEnglishSummary: `${ticker} is up ${data.pctChange.toFixed(1)}% today, trading at $${data.price.toFixed(2)}.`,
      riskNote: `Sharp moves up can reverse quickly. Consider whether this changes your thesis on ${ticker} before acting.`,
    };
  }
  if (type === 'price_down') {
    return {
      plainEnglishSummary: `${ticker} is down ${Math.abs(data.pctChange).toFixed(1)}% today, trading at $${data.price.toFixed(2)}.`,
      riskNote: `A drop this size could be temporary or signal a larger trend. Avoid panic selling without checking the news first.`,
    };
  }
  if (type === 'volume_spike') {
    return {
      plainEnglishSummary: `${ticker} is seeing unusually high trading volume today — ${data.volumeMultiple.toFixed(1)}x its normal level.`,
      riskNote: `High volume often precedes big price moves in either direction. Worth investigating before acting.`,
    };
  }
  return { plainEnglishSummary: '', riskNote: '' };
}

async function evaluateWatchlists() {
  console.log('Running alert evaluation...');

  try {
    console.log('Step 1: Fetching watchlist items...');
    const result = await pool.query(
      `SELECT w.*, u.id as "userId", u.email, u."displayName"
       FROM "WatchlistItem" w
       JOIN "User" u ON w."userId" = u.id`
    );
    const watchlistItems = result.rows;
    console.log('Step 2: Got watchlist items:', watchlistItems.length);

    if (watchlistItems.length === 0) {
      console.log('No watchlist items to evaluate.');
      return;
    }

    const tickers = [...new Set(watchlistItems.map(item => item.ticker))];
    console.log('Step 3: Checking tickers:', tickers.join(', '));

    const snapshots = await getSnapshots(tickers);
    console.log('Step 4: Got snapshots:', snapshots.length);

    if (snapshots.length === 0) {
      console.log('No market data returned — market may be closed.');
      return;
    }

    for (const snapshot of snapshots) {
      const ticker = snapshot.ticker;
      const price = snapshot.day?.c || snapshot.lastTrade?.p;
      const open = snapshot.day?.o;
      const volume = snapshot.day?.v;
      const avgVolume = snapshot.prevDay?.v;

      if (!price || !open) {
        console.log('Skipping', ticker, '— no price data');
        continue;
      }

      const pctChange = ((price - open) / open) * 100;
      const volumeMultiple = avgVolume ? volume / avgVolume : 0;

      const usersWatching = watchlistItems.filter(item => item.ticker === ticker);

      for (const user of usersWatching) {
        if (Math.abs(pctChange) >= PRICE_MOVE_THRESHOLD * 100) {
          const type = pctChange > 0 ? 'price_up' : 'price_down';
          const { plainEnglishSummary, riskNote } = generateAlertMessage(
            ticker, type, { pctChange, price }
          );

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const existing = await pool.query(
            `SELECT id FROM "Alert" WHERE "userId" = $1 AND ticker = $2 AND "alertType" = $3 AND "triggeredAt" >= $4`,
            [user.userId, ticker, type, today]
          );

          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO "Alert" (id, "userId", ticker, "alertType", "plainEnglishSummary", "riskNote") VALUES ($1, $2, $3, $4, $5, $6)`,
              [uuidv4(), user.userId, ticker, type, plainEnglishSummary, riskNote]
            );
            console.log(`Alert created: ${type} for ${ticker} → ${user.email}`);
          }
        }

        if (volumeMultiple >= VOLUME_SPIKE_THRESHOLD) {
          const { plainEnglishSummary, riskNote } = generateAlertMessage(
            ticker, 'volume_spike', { volumeMultiple }
          );

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const existing = await pool.query(
            `SELECT id FROM "Alert" WHERE "userId" = $1 AND ticker = $2 AND "alertType" = $3 AND "triggeredAt" >= $4`,
            [user.userId, ticker, 'volume_spike', today]
          );

          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO "Alert" (id, "userId", ticker, "alertType", "plainEnglishSummary", "riskNote") VALUES ($1, $2, $3, $4, $5, $6)`,
              [uuidv4(), user.userId, ticker, 'volume_spike', plainEnglishSummary, riskNote]
            );
            console.log(`Alert created: volume_spike for ${ticker} → ${user.email}`);
          }
        }
      }
    }

    console.log('Alert evaluation complete.');
  } catch (err) {
    console.error('EVALUATOR ERROR:', err.message);
  }
}

module.exports = { evaluateWatchlists };