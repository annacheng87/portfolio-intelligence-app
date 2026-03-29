const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const requireAuth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

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
    res.json({ holdings: result.rows });
  } catch (err) {
    console.error('HOLDINGS ERROR:', err);
    res.status(500).json({ error: 'Could not fetch holdings.' });
  }
});

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

module.exports = router;