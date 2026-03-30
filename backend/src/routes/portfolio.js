const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const requireAuth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

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
// Marks a single alert as read
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

// Default preferences applied when a user has no saved settings yet
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
// Returns all alert preferences for the logged-in user.
// If the user has never saved preferences, returns the defaults.
router.get('/alert-preferences', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "AlertPreference" WHERE "userId" = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      // User has no saved prefs yet — return defaults (not saved to DB yet)
      return res.json({ preferences: DEFAULT_PREFERENCES, isDefault: true });
    }

    res.json({ preferences: result.rows, isDefault: false });
  } catch (err) {
    console.error('GET PREFS ERROR:', err);
    res.status(500).json({ error: 'Could not fetch alert preferences.' });
  }
});

// PUT /api/portfolio/alert-preferences
// Saves the full set of alert preferences for the logged-in user.
// Expects body: { preferences: [{ alertType, enabled, threshold }] }
// Uses upsert — creates rows that don't exist, updates ones that do.
router.put('/alert-preferences', requireAuth, async (req, res) => {
  const { preferences } = req.body;

  if (!Array.isArray(preferences) || preferences.length === 0) {
    return res.status(400).json({ error: 'preferences array is required.' });
  }

  try {
    // Use a transaction so either all preferences save or none do
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

module.exports = router;