const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const requireAuth = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// GET /api/portfolio/holdings
router.get('/holdings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.* FROM "Holding" h
       JOIN "BrokerConnection" bc ON h."brokerConnectionId" = bc.id
       WHERE bc."userId" = $1`,
      [req.userId]
    );
    return res.json({ holdings: result.rows });
  } catch (err) {
    console.error('HOLDINGS ERROR:', err);
    return res.status(500).json({ error: 'Could not fetch holdings.' });
  }
});

// GET /api/portfolio/watchlist
router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "WatchlistItem" WHERE "userId" = $1 ORDER BY "addedAt" DESC`,
      [req.userId]
    );
    return res.json({ watchlist: result.rows });
  } catch (err) {
    console.error('WATCHLIST GET ERROR:', err);
    return res.status(500).json({ error: 'Could not fetch watchlist.' });
  }
});

// POST /api/portfolio/watchlist
router.post('/watchlist', requireAuth, async (req, res) => {
  const { ticker } = req.body;

  if (!ticker) {
    return res.status(400).json({ error: 'Ticker is required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO "WatchlistItem" (id, "userId", ticker) VALUES ($1, $2, $3) RETURNING *`,
      [uuidv4(), req.userId, ticker.toUpperCase()]
    );
    return res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error('WATCHLIST POST ERROR:', err);
    return res.status(500).json({ error: 'Could not add to watchlist.', details: err.message });
  }
});

// DELETE /api/portfolio/watchlist/:ticker
router.delete('/watchlist/:ticker', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM "WatchlistItem" WHERE "userId" = $1 AND ticker = $2`,
      [req.userId, req.params.ticker.toUpperCase()]
    );
    return res.json({ message: 'Removed from watchlist.' });
  } catch (err) {
    console.error('WATCHLIST DELETE ERROR:', err);
    return res.status(500).json({ error: 'Could not remove from watchlist.' });
  }
});

// GET /api/portfolio/alerts
router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "Alert" WHERE "userId" = $1 ORDER BY "triggeredAt" DESC LIMIT 50`,
      [req.userId]
    );
    return res.json({ alerts: result.rows });
  } catch (err) {
    console.error('ALERTS ERROR:', err);
    return res.status(500).json({ error: 'Could not fetch alerts.' });
  }
});

// GET /api/portfolio/snapshots
router.get('/snapshots', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "PortfolioSnapshot" WHERE "userId" = $1 ORDER BY "snapshotAt" DESC LIMIT 30`,
      [req.userId]
    );
    return res.json({ snapshots: result.rows });
  } catch (err) {
    console.error('SNAPSHOTS ERROR:', err);
    return res.status(500).json({ error: 'Could not fetch snapshots.' });
  }
});

module.exports = router;