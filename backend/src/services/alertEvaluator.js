const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { getSnapshots } = require('./marketData');
const { getTickerSentiment, sentimentToEnglish } = require('./newsSentiment');
const { getTickerRedditSentiment, redditSentimentToEnglish } = require('./redditSentiment');
const { sendRealtimeAlertEmail } = require('./emailService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PRICE_MOVE_THRESHOLD   = 0.05;
const VOLUME_SPIKE_THRESHOLD = 2.0;
const CONCENTRATION_DEFAULT  = 25;
const DRAWDOWN_DEFAULT       = 5;

// ─── Preferences ─────────────────────────────────────────────────────────────

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

// ─── Fetch holdings with portfolio weights ────────────────────────────────────
// Returns map: { userId: { ticker: { quantity, avgCostBasis, portfolioWeight, positionValue } } }

async function fetchHoldingsWithWeights(userIds) {
  if (userIds.length === 0) return {};

  const result = await pool.query(
    `SELECT h.ticker, h.quantity, h."avgCostBasis", bc."userId"
     FROM "Holding" h
     JOIN "BrokerConnection" bc ON h."brokerConnectionId" = bc.id
     WHERE bc."userId" = ANY($1)`,
    [userIds]
  );

  // Group by userId
  const byUser = {};
  for (const row of result.rows) {
    if (!byUser[row.userId]) byUser[row.userId] = [];
    byUser[row.userId].push({
      ticker:       row.ticker,
      quantity:     parseFloat(row.quantity),
      avgCostBasis: parseFloat(row.avgCostBasis),
    });
  }

  // Get prices for all held tickers to calculate portfolio weights
  const allTickers = [...new Set(result.rows.map(r => r.ticker))];
  if (allTickers.length === 0) return {};

  const snapshots = await getSnapshots(allTickers);
  const priceMap  = {};
  for (const s of snapshots) {
    priceMap[s.ticker] = s.day?.c || null;
  }

  // Calculate portfolio weights per user
  const holdingsMap = {};
  for (const [userId, holdings] of Object.entries(byUser)) {
    // Total portfolio value
    let totalValue = 0;
    for (const h of holdings) {
      const price = priceMap[h.ticker];
      if (price) totalValue += h.quantity * price;
    }

    holdingsMap[userId] = {};
    for (const h of holdings) {
      const price         = priceMap[h.ticker];
      const positionValue = price ? h.quantity * price : null;
      const weight        = (positionValue && totalValue > 0) ? (positionValue / totalValue) * 100 : 0;
      holdingsMap[userId][h.ticker] = {
        quantity:       h.quantity,
        avgCostBasis:   h.avgCostBasis,
        positionValue,
        portfolioWeight: parseFloat(weight.toFixed(1)),
        totalPortfolioValue: totalValue,
      };
    }
  }

  return holdingsMap;
}

// ─── Alert message builder ────────────────────────────────────────────────────

function generateAlertMessage(ticker, type, data, newsSentiment, redditSentiment) {
  const newsLine   = newsSentiment   ? `\n${sentimentToEnglish(newsSentiment)}`                 : '';
  const redditLine = redditSentiment ? `\n${redditSentimentToEnglish(ticker, redditSentiment)}` : '';
  const weightNote = data.portfolioWeight > 0 ? ` It makes up ${data.portfolioWeight}% of your portfolio.` : '';

  if (type === 'price_up') {
    return {
      plainEnglishSummary: `${ticker} is up ${data.pctChange.toFixed(1)}% today, trading at $${data.price.toFixed(2)}.${weightNote}${newsLine}${redditLine}`,
      riskNote: `Sharp moves up can reverse quickly. Consider whether this changes your thesis on ${ticker} before acting.`,
    };
  }
  if (type === 'price_down') {
    return {
      plainEnglishSummary: `${ticker} is down ${Math.abs(data.pctChange).toFixed(1)}% today, trading at $${data.price.toFixed(2)}.${weightNote}${newsLine}${redditLine}`,
      riskNote: `A drop this size could be temporary or signal a larger trend. Avoid panic selling without checking the news first.`,
    };
  }
  if (type === 'volume_spike') {
    return {
      plainEnglishSummary: `${ticker} is seeing unusually high trading volume — ${data.volumeMultiple.toFixed(1)}x normal.${weightNote}${newsLine}${redditLine}`,
      riskNote: `High volume often precedes big price moves. Worth investigating before acting.`,
    };
  }
  if (type === 'concentration_risk') {
    return {
      plainEnglishSummary: `${ticker} now makes up ${data.portfolioWeight}% of your portfolio — above your ${data.threshold}% concentration limit.`,
      riskNote: `High concentration in a single stock increases your risk. Consider whether this aligns with your investment strategy.`,
    };
  }
  if (type === 'drawdown') {
    return {
      plainEnglishSummary: `Your portfolio has dropped ${data.drawdownPct.toFixed(1)}% from its recent high of $${data.recentHigh.toFixed(2)}.`,
      riskNote: `Drawdowns are a normal part of investing. Avoid making emotional decisions based on short-term losses.`,
    };
  }
  return { plainEnglishSummary: '', riskNote: '' };
}

// ─── Insert alert helper ──────────────────────────────────────────────────────

async function insertAlertIfNew(userId, ticker, alertType, plainEnglishSummary, riskNote, extras = {}) {
  const today = new Date(); today.setHours(0,0,0,0);
  const existing = await pool.query(
    `SELECT id FROM "Alert" WHERE "userId"=$1 AND ticker=$2 AND "alertType"=$3 AND "triggeredAt">=$4`,
    [userId, ticker, alertType, today]
  );
  if (existing.rows.length > 0) return false;

  await pool.query(
    `INSERT INTO "Alert" (id,"userId",ticker,"alertType","plainEnglishSummary","riskNote","newsUrl","newsHeadline","redditUrl","redditTitle")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [uuidv4(), userId, ticker, alertType, plainEnglishSummary, riskNote,
     extras.newsUrl||null, extras.newsHeadline||null,
     extras.redditUrl||null, extras.redditTitle||null]
  );
  return true;
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

async function evaluateWatchlists() {
  console.log('Running alert evaluation...');
  try {

    // 1. Fetch watchlist items
    const wResult = await pool.query(
      `SELECT w.*, u.id as "userId", u.email, u."displayName"
       FROM "WatchlistItem" w JOIN "User" u ON w."userId" = u.id`
    );
    const watchlistItems = wResult.rows;

    // 2. Fetch all users who have holdings
    const hResult = await pool.query(
      `SELECT DISTINCT bc."userId", u.email, u."displayName"
       FROM "Holding" h
       JOIN "BrokerConnection" bc ON h."brokerConnectionId" = bc.id
       JOIN "User" u ON bc."userId" = u.id`
    );
    const holdingUsers = hResult.rows;

    // 3. Combine all unique users
    const allUserMap = {};
    for (const u of [...watchlistItems, ...holdingUsers]) {
      if (!allUserMap[u.userId]) allUserMap[u.userId] = { userId: u.userId, email: u.email, displayName: u.displayName };
    }
    const allUsers  = Object.values(allUserMap);
    const allUserIds = allUsers.map(u => u.userId);

    if (allUsers.length === 0) { console.log('No users to evaluate.'); return; }

    // 4. Fetch preferences and holdings with weights
    const prefsMap    = await fetchAllUserPreferences(allUserIds);
    const holdingsMap = await fetchHoldingsWithWeights(allUserIds);
    console.log(`Evaluating ${allUsers.length} users — ${watchlistItems.length} watchlist items`);

    // 5. Combine all unique tickers (watchlist + holdings)
    const watchlistTickers = watchlistItems.map(i => i.ticker);
    const holdingTickers   = Object.values(holdingsMap).flatMap(h => Object.keys(h));
    const allTickers       = [...new Set([...watchlistTickers, ...holdingTickers])];

    if (allTickers.length === 0) { console.log('No tickers to evaluate.'); return; }

    const snapshots = await getSnapshots(allTickers);
    if (snapshots.length === 0) { console.log('No market data — market may be closed.'); return; }

    // 6. Evaluate each ticker
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

      // Find all users who watch or hold this ticker
      const watchingUsers = watchlistItems.filter(i => i.ticker === ticker).map(i => allUserMap[i.userId]).filter(Boolean);
      const holdingUsersForTicker = Object.entries(holdingsMap)
        .filter(([, holdings]) => holdings[ticker])
        .map(([userId]) => allUserMap[userId])
        .filter(Boolean);

      // Merge — holdings users get priority (they have real portfolio weight)
      const userSet = {};
      for (const u of [...watchingUsers, ...holdingUsersForTicker]) {
        if (u) userSet[u.userId] = u;
      }
      const usersToAlert = Object.values(userSet);

      for (const user of usersToAlert) {
        const holding        = holdingsMap[user.userId]?.[ticker];
        const portfolioWeight = holding?.portfolioWeight || 0;
        const positionValue   = holding?.positionValue   || null;

        // ── Price alert ─────────────────────────────────────────────────────
        const priceEnabled   = isAlertEnabled(prefsMap, user.userId, 'large_holding_move');
        const priceThreshold = getThreshold(prefsMap, user.userId, 'large_holding_move', PRICE_MOVE_THRESHOLD * 100);

        // For holdings: only alert if position is meaningful (>= 3% of portfolio)
        // For watchlist-only: always alert if threshold is met
        const isMeaningfulPosition = holding ? portfolioWeight >= 3 : true;

        if (priceEnabled && Math.abs(pctChange) >= priceThreshold && isMeaningfulPosition) {
          const type = pctChange > 0 ? 'price_up' : 'price_down';
          const { plainEnglishSummary, riskNote } = generateAlertMessage(
            ticker, type, { pctChange, price, portfolioWeight }, newsSentiment, redditSentiment
          );
          const inserted = await insertAlertIfNew(user.userId, ticker, type, plainEnglishSummary, riskNote, {
            newsUrl:      newsSentiment?.topArticle?.url||null,
            newsHeadline: newsSentiment?.topArticle?.headline||null,
            redditUrl:    redditSentiment?.topPost?.url||null,
            redditTitle:  redditSentiment?.topPost?.title||null,
          });
          if (inserted) {
            console.log(`Alert: ${type} ${ticker} → ${user.email} (weight: ${portfolioWeight}%, threshold: ${priceThreshold}%)`);
            try {
              await sendRealtimeAlertEmail(user.email, {
                ticker, alertType: type, pctChange, currentPrice: price, priceChange,
                portfolioWeight, positionValue: positionValue ? `$${positionValue.toFixed(2)}` : null,
                plainEnglishSummary, riskNote,
                newsHeadline: newsSentiment?.topArticle?.headline||null,
                newsUrl:      newsSentiment?.topArticle?.url||null,
                redditTitle:  redditSentiment?.topPost?.title||null,
                redditUrl:    redditSentiment?.topPost?.url||null,
              });
            } catch (e) { console.error(`Email failed for ${user.email}:`, e.message); }
          }
        }

        // ── Volume spike alert ───────────────────────────────────────────────
        const volumeEnabled   = isAlertEnabled(prefsMap, user.userId, 'volume_spike');
        const volumeThreshold = getThreshold(prefsMap, user.userId, 'volume_spike', VOLUME_SPIKE_THRESHOLD);

        if (volumeEnabled && volumeMultiple >= volumeThreshold && isMeaningfulPosition) {
          const { plainEnglishSummary, riskNote } = generateAlertMessage(
            ticker, 'volume_spike', { volumeMultiple, portfolioWeight }, newsSentiment, redditSentiment
          );
          const inserted = await insertAlertIfNew(user.userId, ticker, 'volume_spike', plainEnglishSummary, riskNote, {
            newsUrl:      newsSentiment?.topArticle?.url||null,
            newsHeadline: newsSentiment?.topArticle?.headline||null,
            redditUrl:    redditSentiment?.topPost?.url||null,
            redditTitle:  redditSentiment?.topPost?.title||null,
          });
          if (inserted) {
            console.log(`Alert: volume_spike ${ticker} → ${user.email}`);
            try {
              await sendRealtimeAlertEmail(user.email, {
                ticker, alertType: 'volume_spike', pctChange, currentPrice: price, priceChange,
                portfolioWeight, positionValue: positionValue ? `$${positionValue.toFixed(2)}` : null,
                plainEnglishSummary, riskNote,
                newsHeadline: newsSentiment?.topArticle?.headline||null,
                newsUrl:      newsSentiment?.topArticle?.url||null,
                redditTitle:  redditSentiment?.topPost?.title||null,
                redditUrl:    redditSentiment?.topPost?.url||null,
              });
            } catch (e) { console.error(`Email failed for ${user.email}:`, e.message); }
          }
        }

        // ── Concentration risk alert (holdings only) ─────────────────────────
        if (holding) {
          const concEnabled   = isAlertEnabled(prefsMap, user.userId, 'concentration_risk');
          const concThreshold = getThreshold(prefsMap, user.userId, 'concentration_risk', CONCENTRATION_DEFAULT);

          if (concEnabled && portfolioWeight >= concThreshold) {
            const { plainEnglishSummary, riskNote } = generateAlertMessage(
              ticker, 'concentration_risk', { portfolioWeight, threshold: concThreshold }, null, null
            );
            const inserted = await insertAlertIfNew(user.userId, ticker, 'concentration_risk', plainEnglishSummary, riskNote);
            if (inserted) {
              console.log(`Alert: concentration_risk ${ticker} → ${user.email} (${portfolioWeight}%)`);
              try {
                await sendRealtimeAlertEmail(user.email, {
                  ticker, alertType: 'concentration_risk', pctChange: 0, currentPrice: price, priceChange: 0,
                  portfolioWeight, positionValue: positionValue ? `$${positionValue.toFixed(2)}` : null,
                  plainEnglishSummary, riskNote,
                });
              } catch (e) { console.error(`Email failed for ${user.email}:`, e.message); }
            }
          }
        }
      }
    }

    // 7. Drawdown check — portfolio level, not per ticker
    await evaluateDrawdowns(allUsers, holdingsMap, prefsMap);

    console.log('Alert evaluation complete.');
  } catch (err) {
    console.error('EVALUATOR ERROR:', err.message);
  }
}

// ─── Drawdown evaluator ───────────────────────────────────────────────────────
// Compares current portfolio value against the highest snapshot in last 30 days

async function evaluateDrawdowns(users, holdingsMap, prefsMap) {
  for (const user of users) {
    try {
      const drawdownEnabled   = isAlertEnabled(prefsMap, user.userId, 'drawdown');
      const drawdownThreshold = getThreshold(prefsMap, user.userId, 'drawdown', DRAWDOWN_DEFAULT);
      if (!drawdownEnabled) continue;

      const userHoldings = holdingsMap[user.userId];
      if (!userHoldings) continue;

      // Current portfolio value
      const currentValue = Object.values(userHoldings).reduce((sum, h) => sum + (h.positionValue || 0), 0);
      if (currentValue === 0) continue;

      // Highest portfolio value in last 30 days from snapshots
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const snapResult = await pool.query(
        `SELECT MAX("totalValue") as "recentHigh"
         FROM "PortfolioSnapshot"
         WHERE "userId" = $1 AND "snapshotAt" >= $2`,
        [user.userId, thirtyDaysAgo]
      );
      const recentHigh = parseFloat(snapResult.rows[0]?.recentHigh || 0);
      if (recentHigh === 0) continue;

      const drawdownPct = ((recentHigh - currentValue) / recentHigh) * 100;
      if (drawdownPct >= drawdownThreshold) {
        const { plainEnglishSummary, riskNote } = generateAlertMessage(
          'PORTFOLIO', 'drawdown', { drawdownPct, recentHigh }, null, null
        );
        const inserted = await insertAlertIfNew(user.userId, 'PORTFOLIO', 'drawdown', plainEnglishSummary, riskNote);
        if (inserted) {
          console.log(`Alert: drawdown → ${user.email} (${drawdownPct.toFixed(1)}% from high)`);
          try {
            await sendRealtimeAlertEmail(user.email, {
              ticker: 'PORTFOLIO', alertType: 'drawdown', pctChange: -drawdownPct,
              currentPrice: currentValue, priceChange: currentValue - recentHigh,
              portfolioWeight: 100, positionValue: `$${currentValue.toFixed(2)}`,
              plainEnglishSummary, riskNote,
            });
          } catch (e) { console.error(`Email failed for ${user.email}:`, e.message); }
        }
      }
    } catch (err) {
      console.error(`Drawdown check failed for ${user.email}:`, err.message);
    }
  }
}

module.exports = { evaluateWatchlists };