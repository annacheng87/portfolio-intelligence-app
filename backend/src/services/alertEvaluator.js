const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { getSnapshots } = require('./marketData');
const { getTickerSentiment, sentimentToEnglish } = require('./newsSentiment');
const { getTickerRedditSentiment, redditSentimentToEnglish } = require('./redditSentiment');
const { sendRealtimeAlertEmail } = require('./emailService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PRICE_MOVE_THRESHOLD  = 0.05;
const VOLUME_SPIKE_THRESHOLD = 2.0;

async function fetchAllUserPreferences(userIds) {
  if (userIds.length === 0) return {};
  const result = await pool.query(
    `SELECT "userId", "alertType", enabled, threshold FROM "AlertPreference" WHERE "userId" = ANY($1)`,
    [userIds]
  );
  const map = {};
  for (const row of result.rows) {
    if (!map[row.userId]) map[row.userId] = {};
    map[row.userId][row.alertType] = {
      enabled:   row.enabled,
      threshold: row.threshold ? parseFloat(row.threshold) : null,
    };
  }
  return map;
}

function isAlertEnabled(prefsMap, userId, alertType) {
  const userPrefs = prefsMap[userId];
  if (!userPrefs) return true;
  const pref = userPrefs[alertType];
  if (!pref) return true;
  return pref.enabled;
}

function getThreshold(prefsMap, userId, alertType, defaultValue) {
  const userPrefs = prefsMap[userId];
  if (!userPrefs) return defaultValue;
  const pref = userPrefs[alertType];
  if (!pref || pref.threshold === null) return defaultValue;
  return pref.threshold;
}

function generateAlertMessage(ticker, type, data, newsSentiment, redditSentiment) {
  const newsLine   = newsSentiment   ? `\n${sentimentToEnglish(newsSentiment)}`                 : '';
  const redditLine = redditSentiment ? `\n${redditSentimentToEnglish(ticker, redditSentiment)}` : '';
  if (type === 'price_up') {
    return {
      plainEnglishSummary: `${ticker} is up ${data.pctChange.toFixed(1)}% today, trading at $${data.price.toFixed(2)}.${newsLine}${redditLine}`,
      riskNote: `Sharp moves up can reverse quickly. Consider whether this changes your thesis on ${ticker} before acting.`,
    };
  }
  if (type === 'price_down') {
    return {
      plainEnglishSummary: `${ticker} is down ${Math.abs(data.pctChange).toFixed(1)}% today, trading at $${data.price.toFixed(2)}.${newsLine}${redditLine}`,
      riskNote: `A drop this size could be temporary or signal a larger trend. Avoid panic selling without checking the news first.`,
    };
  }
  if (type === 'volume_spike') {
    return {
      plainEnglishSummary: `${ticker} is seeing unusually high trading volume — ${data.volumeMultiple.toFixed(1)}x normal.${newsLine}${redditLine}`,
      riskNote: `High volume often precedes big price moves. Worth investigating before acting.`,
    };
  }
  return { plainEnglishSummary: '', riskNote: '' };
}

async function evaluateWatchlists() {
  console.log('Running alert evaluation...');
  try {
    const result = await pool.query(
      `SELECT w.*, u.id as "userId", u.email, u."displayName"
       FROM "WatchlistItem" w JOIN "User" u ON w."userId" = u.id`
    );
    const watchlistItems = result.rows;
    console.log('Watchlist items:', watchlistItems.length);
    if (watchlistItems.length === 0) { console.log('No watchlist items.'); return; }

    const userIds  = [...new Set(watchlistItems.map(i => i.userId))];
    const prefsMap = await fetchAllUserPreferences(userIds);
    console.log(`Preferences loaded for ${Object.keys(prefsMap).length} users`);

    const tickers   = [...new Set(watchlistItems.map(i => i.ticker))];
    const snapshots = await getSnapshots(tickers);
    if (snapshots.length === 0) { console.log('No market data — market may be closed.'); return; }

    for (const snapshot of snapshots) {
      const ticker     = snapshot.ticker;
      const price      = snapshot.day?.c || snapshot.lastTrade?.p;
      const open       = snapshot.day?.o;
      const volume     = snapshot.day?.v;
      const avgVolume  = snapshot.prevDay?.v;
      if (!price || !open) { console.log('Skipping', ticker, '— no price data'); continue; }

      const pctChange      = ((price - open) / open) * 100;
      const priceChange    = price - open;
      const volumeMultiple = avgVolume ? volume / avgVolume : 0;

      const [newsSentiment, redditSentiment] = await Promise.all([
        getTickerSentiment(ticker),
        getTickerRedditSentiment(ticker),
      ]);

      const usersWatching = watchlistItems.filter(i => i.ticker === ticker);

      for (const user of usersWatching) {

        // ── Price alert ───────────────────────────────────────────────────────
        const priceEnabled   = isAlertEnabled(prefsMap, user.userId, 'large_holding_move');
        const priceThreshold = getThreshold(prefsMap, user.userId, 'large_holding_move', PRICE_MOVE_THRESHOLD * 100);

        if (priceEnabled && Math.abs(pctChange) >= priceThreshold) {
          const type = pctChange > 0 ? 'price_up' : 'price_down';
          const { plainEnglishSummary, riskNote } = generateAlertMessage(ticker, type, { pctChange, price }, newsSentiment, redditSentiment);
          const today = new Date(); today.setHours(0,0,0,0);
          const existing = await pool.query(
            `SELECT id FROM "Alert" WHERE "userId"=$1 AND ticker=$2 AND "alertType"=$3 AND "triggeredAt">=$4`,
            [user.userId, ticker, type, today]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO "Alert" (id,"userId",ticker,"alertType","plainEnglishSummary","riskNote","newsUrl","newsHeadline","redditUrl","redditTitle")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [uuidv4(), user.userId, ticker, type, plainEnglishSummary, riskNote,
               newsSentiment?.topArticle?.url||null, newsSentiment?.topArticle?.headline||null,
               redditSentiment?.topPost?.url||null,  redditSentiment?.topPost?.title||null]
            );
            console.log(`Alert: ${type} ${ticker} → ${user.email} (threshold: ${priceThreshold}%)`);
            try {
              await sendRealtimeAlertEmail(user.email, {
                ticker, alertType: type, pctChange, currentPrice: price, priceChange,
                portfolioWeight: 0, positionValue: null, plainEnglishSummary, riskNote,
                newsHeadline: newsSentiment?.topArticle?.headline||null,
                newsUrl:      newsSentiment?.topArticle?.url||null,
                redditTitle:  redditSentiment?.topPost?.title||null,
                redditUrl:    redditSentiment?.topPost?.url||null,
              });
            } catch (e) { console.error(`Email failed for ${user.email}:`, e.message); }
          }
        } else if (!priceEnabled) {
          console.log(`Skipping price alert for ${user.email} — disabled in preferences`);
        }

        // ── Volume spike alert ────────────────────────────────────────────────
        const volumeEnabled   = isAlertEnabled(prefsMap, user.userId, 'volume_spike');
        const volumeThreshold = getThreshold(prefsMap, user.userId, 'volume_spike', VOLUME_SPIKE_THRESHOLD);

        if (volumeEnabled && volumeMultiple >= volumeThreshold) {
          const { plainEnglishSummary, riskNote } = generateAlertMessage(ticker, 'volume_spike', { volumeMultiple }, newsSentiment, redditSentiment);
          const today = new Date(); today.setHours(0,0,0,0);
          const existing = await pool.query(
            `SELECT id FROM "Alert" WHERE "userId"=$1 AND ticker=$2 AND "alertType"=$3 AND "triggeredAt">=$4`,
            [user.userId, ticker, 'volume_spike', today]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO "Alert" (id,"userId",ticker,"alertType","plainEnglishSummary","riskNote","newsUrl","newsHeadline","redditUrl","redditTitle")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [uuidv4(), user.userId, ticker, 'volume_spike', plainEnglishSummary, riskNote,
               newsSentiment?.topArticle?.url||null, newsSentiment?.topArticle?.headline||null,
               redditSentiment?.topPost?.url||null,  redditSentiment?.topPost?.title||null]
            );
            console.log(`Alert: volume_spike ${ticker} → ${user.email} (threshold: ${volumeThreshold}x)`);
            try {
              await sendRealtimeAlertEmail(user.email, {
                ticker, alertType: 'volume_spike', pctChange, currentPrice: price, priceChange,
                portfolioWeight: 0, positionValue: null, plainEnglishSummary, riskNote,
                newsHeadline: newsSentiment?.topArticle?.headline||null,
                newsUrl:      newsSentiment?.topArticle?.url||null,
                redditTitle:  redditSentiment?.topPost?.title||null,
                redditUrl:    redditSentiment?.topPost?.url||null,
              });
            } catch (e) { console.error(`Email failed for ${user.email}:`, e.message); }
          }
        } else if (!volumeEnabled) {
          console.log(`Skipping volume alert for ${user.email} — disabled in preferences`);
        }

      }
    }
    console.log('Alert evaluation complete.');
  } catch (err) {
    console.error('EVALUATOR ERROR:', err.message);
  }
}

module.exports = { evaluateWatchlists };