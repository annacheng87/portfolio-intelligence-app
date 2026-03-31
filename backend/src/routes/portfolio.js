const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const requireAuth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { getPreviousClose } = require('../services/marketData');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ─── Holdings ─────────────────────────────────────────────────────────────────

// GET /api/portfolio/holdings
router.get('/holdings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.* FROM "Holding" h
       JOIN "BrokerConnection" bc ON h."brokerConnectionId" = bc.id
       WHERE bc."userId" = $1`,
      [req.userId]
    );
    res.json({ holdings: result.rows });
  } catch (err) {
    console.error('HOLDINGS ERROR:', err);
    res.status(500).json({ error: 'Could not fetch holdings.' });
  }
});

// ─── Performance ──────────────────────────────────────────────────────────────

// GET /api/portfolio/performance
router.get('/performance', requireAuth, async (req, res) => {
  try {
    const holdingsResult = await pool.query(
      `SELECT h.* FROM "Holding" h
       JOIN "BrokerConnection" bc ON h."brokerConnectionId" = bc.id
       WHERE bc."userId" = $1`,
      [req.userId]
    );
    const holdings = holdingsResult.rows;

    if (holdings.length === 0) {
      return res.json({
        holdings: [],
        summary: {
          totalValue:     0,
          totalCost:      0,
          totalReturn:    0,
          totalReturnPct: 0,
          dailyPnL:       0,
          dailyPnLPct:    0,
        },
      });
    }

    const tickers = [...new Set(holdings.map(h => h.ticker))];
    const priceResults = await Promise.all(
      tickers.map(ticker => getPreviousClose(ticker))
    );

    const priceMap = {};
    for (const p of priceResults) {
      if (p) priceMap[p.ticker] = p;
    }

    let totalValue    = 0;
    let totalCost     = 0;
    let totalDailyPnL = 0;

    const enriched = holdings.map(h => {
      const qty      = parseFloat(h.quantity);
      const avgCost  = parseFloat(h.avgCostBasis);
      const price    = priceMap[h.ticker];

      const currentPrice = price?.close ?? null;
      const openPrice    = price?.open  ?? null;

      const positionValue = currentPrice !== null ? qty * currentPrice : null;
      const positionCost  = qty * avgCost;

      const gainLoss    = positionValue !== null ? positionValue - positionCost : null;
      const gainLossPct = positionValue !== null
        ? ((positionValue - positionCost) / positionCost) * 100
        : null;

      const dailyPnL = (currentPrice !== null && openPrice !== null)
        ? qty * (currentPrice - openPrice)
        : null;
      const dailyPct = (currentPrice !== null && openPrice !== null)
        ? ((currentPrice - openPrice) / openPrice) * 100
        : null;

      if (positionValue !== null) totalValue    += positionValue;
      if (dailyPnL      !== null) totalDailyPnL += dailyPnL;
      totalCost += positionCost;

      return {
        id:             h.id,
        ticker:         h.ticker,
        quantity:       qty,
        avgCostBasis:   avgCost,
        currentPrice,
        positionValue,
        positionCost,
        gainLoss,
        gainLossPct,
        dailyPnL,
        dailyPct,
        portfolioWeight: null,
      };
    });

    for (const h of enriched) {
      h.portfolioWeight = (h.positionValue !== null && totalValue > 0)
        ? (h.positionValue / totalValue) * 100
        : null;
    }

    enriched.sort((a, b) => (b.portfolioWeight ?? 0) - (a.portfolioWeight ?? 0));

    const totalReturn    = totalValue - totalCost;
    const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;
    const dailyPnLPct    = (totalValue - totalDailyPnL) > 0
      ? (totalDailyPnL / (totalValue - totalDailyPnL)) * 100
      : 0;

    try {
      await pool.query(
        `INSERT INTO "PortfolioSnapshot" (id, "userId", "totalValue", "dailyPctChange")
         VALUES ($1, $2, $3, $4)`,
        [uuidv4(), req.userId, totalValue.toFixed(2), dailyPnLPct.toFixed(4)]
      );
    } catch (snapErr) {
      console.error('Snapshot save error:', snapErr.message);
    }

    res.json({
      holdings: enriched,
      summary: {
        totalValue:     parseFloat(totalValue.toFixed(2)),
        totalCost:      parseFloat(totalCost.toFixed(2)),
        totalReturn:    parseFloat(totalReturn.toFixed(2)),
        totalReturnPct: parseFloat(totalReturnPct.toFixed(2)),
        dailyPnL:       parseFloat(totalDailyPnL.toFixed(2)),
        dailyPnLPct:    parseFloat(dailyPnLPct.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('PERFORMANCE ERROR:', err);
    res.status(500).json({ error: 'Could not calculate performance.' });
  }
});

// ─── Watchlist ────────────────────────────────────────────────────────────────

// GET /api/portfolio/watchlist
router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "WatchlistItem" WHERE "userId" = $1 ORDER BY "addedAt" DESC`,
      [req.userId]
    );
    res.json({ watchlist: result.rows });
  } catch (err) {
    console.error('WATCHLIST ERROR:', err);
    res.status(500).json({ error: 'Could not fetch watchlist.' });
  }
});

// POST /api/portfolio/watchlist
router.post('/watchlist', requireAuth, async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Ticker is required.' });
  try {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO "WatchlistItem" (id, "userId", ticker) VALUES ($1, $2, $3) RETURNING *`,
      [id, req.userId, ticker.toUpperCase()]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error('ADD WATCHLIST ERROR:', err);
    res.status(500).json({ error: 'Could not add to watchlist.' });
  }
});

// DELETE /api/portfolio/watchlist/:ticker
router.delete('/watchlist/:ticker', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM "WatchlistItem" WHERE "userId" = $1 AND ticker = $2`,
      [req.userId, req.params.ticker.toUpperCase()]
    );
    res.json({ message: 'Removed from watchlist.' });
  } catch (err) {
    console.error('REMOVE WATCHLIST ERROR:', err);
    res.status(500).json({ error: 'Could not remove from watchlist.' });
  }
});

// ─── Alerts ───────────────────────────────────────────────────────────────────

// GET /api/portfolio/alerts
router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "Alert" WHERE "userId" = $1 ORDER BY "triggeredAt" DESC LIMIT 50`,
      [req.userId]
    );
    res.json({ alerts: result.rows });
  } catch (err) {
    console.error('ALERTS ERROR:', err);
    res.status(500).json({ error: 'Could not fetch alerts.' });
  }
});

// PATCH /api/portfolio/alerts/:id/read
router.patch('/alerts/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE "Alert" SET "isRead" = true WHERE id = $1 AND "userId" = $2`,
      [req.params.id, req.userId]
    );
    res.json({ message: 'Alert marked as read.' });
  } catch (err) {
    console.error('MARK READ ERROR:', err);
    res.status(500).json({ error: 'Could not mark alert as read.' });
  }
});

// ─── Alert Preferences ────────────────────────────────────────────────────────

const DEFAULT_PREFERENCES = [
  { alertType: 'large_holding_move',     enabled: true,  threshold: 5    },
  { alertType: 'portfolio_value_change', enabled: true,  threshold: 2    },
  { alertType: 'drawdown',               enabled: true,  threshold: 5    },
  { alertType: 'watchlist_price_target', enabled: true,  threshold: null },
  { alertType: 'major_news',             enabled: true,  threshold: null },
  { alertType: 'earnings',               enabled: true,  threshold: null },
  { alertType: 'volume_spike',           enabled: true,  threshold: 2    },
  { alertType: 'concentration_risk',     enabled: true,  threshold: 25   },
  { alertType: 'cost_basis_deviation',   enabled: false, threshold: 15   },
  { alertType: 'dividend_corporate',     enabled: false, threshold: null },
  { alertType: 'reddit_alignment',       enabled: false, threshold: null },
  { alertType: 'watchlist_move',         enabled: true,  threshold: 5    },
  { alertType: 'watchlist_news',         enabled: false, threshold: null },
  { alertType: 'rank_passed',            enabled: true,  threshold: null },
  { alertType: 'top_3_entered',          enabled: true,  threshold: null },
  { alertType: 'streak_milestone',       enabled: false, threshold: null },
  { alertType: 'daily_digest',           enabled: true,  threshold: null },
  { alertType: 'weekly_digest',          enabled: true,  threshold: null },
  { alertType: 'sms_realtime',           enabled: false, threshold: null },
];

// GET /api/portfolio/alert-preferences
router.get('/alert-preferences', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "AlertPreference" WHERE "userId" = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ preferences: DEFAULT_PREFERENCES, isDefault: true });
    }
    res.json({ preferences: result.rows, isDefault: false });
  } catch (err) {
    console.error('GET PREFS ERROR:', err);
    res.status(500).json({ error: 'Could not fetch alert preferences.' });
  }
});

// PUT /api/portfolio/alert-preferences
router.put('/alert-preferences', requireAuth, async (req, res) => {
  const { preferences } = req.body;
  if (!Array.isArray(preferences) || preferences.length === 0) {
    return res.status(400).json({ error: 'preferences array is required.' });
  }
  try {
    await pool.query('BEGIN');
    for (const pref of preferences) {
      const { alertType, enabled, threshold } = pref;
      if (!alertType) continue;
      await pool.query(
        `INSERT INTO "AlertPreference" (id, "userId", "alertType", enabled, threshold, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT ("userId", "alertType")
         DO UPDATE SET enabled = $4, threshold = $5, "updatedAt" = NOW()`,
        [uuidv4(), req.userId, alertType, enabled ?? true, threshold ?? null]
      );
    }
    await pool.query('COMMIT');
    res.json({ message: 'Alert preferences saved.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('SAVE PREFS ERROR:', err);
    res.status(500).json({ error: 'Could not save alert preferences.' });
  }
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────

// GET /api/portfolio/leaderboard — global leaderboard
router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    // Get all opted-in users
    const usersResult = await pool.query(
      `SELECT id, "displayName" FROM "User" WHERE "leaderboardOptIn" = true`
    );
    const users = usersResult.rows;

    if (users.length === 0) return res.json([]);

    // Get latest snapshot for each user
    const snapshots = await Promise.all(
      users.map(u =>
        pool.query(
          `SELECT "dailyPctChange" FROM "PortfolioSnapshot"
           WHERE "userId" = $1
           ORDER BY "snapshotAt" DESC
           LIMIT 1`,
          [u.id]
        )
      )
    );

    const entries = users
      .map((u, i) => ({
        userId:         u.id,
        displayName:    u.displayName || `Trader #${u.id.slice(-4)}`,
        dailyPctChange: snapshots[i].rows[0]
          ? parseFloat(snapshots[i].rows[0].dailyPctChange)
          : null,
        isYou: u.id === req.userId,
      }))
      .filter(e => e.dailyPctChange !== null)
      .sort((a, b) => b.dailyPctChange - a.dailyPctChange)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    res.json(entries);
  } catch (err) {
    console.error('LEADERBOARD ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

// PATCH /api/portfolio/leaderboard-optin
router.patch('/leaderboard-optin', requireAuth, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required.' });
  }
  try {
    await pool.query(
      `UPDATE "User" SET "leaderboardOptIn" = $1 WHERE id = $2`,
      [enabled, req.userId]
    );
    res.json({ leaderboardOptIn: enabled });
  } catch (err) {
    console.error('OPT-IN ERROR:', err);
    res.status(500).json({ error: 'Failed to update leaderboard opt-in.' });
  }
});

module.exports = router;