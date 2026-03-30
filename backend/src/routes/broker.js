const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const requireAuth = require('../middleware/auth');
const {
  registerSnaptradeUser,
  generateConnectionLink,
  getAllHoldings,
} = require('../services/snaptrade');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// POST /api/broker/connect
// Step 1 — register user with Snaptrade and get a connection link
router.post('/connect', requireAuth, async (req, res) => {
  try {
    // Register the user with Snaptrade using their app user ID
    const snaptradeUser = await registerSnaptradeUser(req.userId);
    const userSecret = snaptradeUser.userSecret;

    // Save the userSecret to the database so we can use it later
    await pool.query(
      `UPDATE "User" SET "snaptradeSecret" = $1 WHERE id = $2`,
      [userSecret, req.userId]
    );

    // Generate a link for the user to connect their broker
    const connectionData = await generateConnectionLink(req.userId, userSecret);

    res.json({
      redirectUri: connectionData.redirectURI,
      message: 'Redirect user to this URL to connect their broker',
    });
  } catch (err) {
    console.error('Broker connect error:', err.message);
    res.status(500).json({ error: 'Failed to initiate broker connection.' });
  }
});

// POST /api/broker/sync
// Step 2 — sync holdings from connected broker accounts
router.post('/sync', requireAuth, async (req, res) => {
  try {
    // Get the user's Snaptrade secret
    const userResult = await pool.query(
      `SELECT "snaptradeSecret" FROM "User" WHERE id = $1`,
      [req.userId]
    );
    const userSecret = userResult.rows[0]?.snaptradeSecret;

    if (!userSecret) {
      return res.status(400).json({ error: 'No broker connected. Please connect a broker first.' });
    }

    // Fetch all holdings from Snaptrade
    const holdings = await getAllHoldings(req.userId, userSecret);

    if (holdings.length === 0) {
      return res.json({ message: 'No holdings found.', synced: 0 });
    }

    // Find or create a broker connection record
    let connectionResult = await pool.query(
      `SELECT id FROM "BrokerConnection" WHERE "userId" = $1 AND provider = 'snaptrade'`,
      [req.userId]
    );

    let connectionId;
    if (connectionResult.rows.length === 0) {
      const newConnection = await pool.query(
        `INSERT INTO "BrokerConnection" (id, "userId", provider, "encryptedToken", "accountId")
         VALUES ($1, $2, 'snaptrade', $3, 'multiple') RETURNING id`,
        [uuidv4(), req.userId, userSecret]
      );
      connectionId = newConnection.rows[0].id;
    } else {
      connectionId = connectionResult.rows[0].id;
    }

    // Delete old holdings and insert fresh ones
    await pool.query(
      `DELETE FROM "Holding" WHERE "brokerConnectionId" = $1`,
      [connectionId]
    );

    for (const holding of holdings) {
      if (!holding.ticker) continue;
      await pool.query(
        `INSERT INTO "Holding" (id, "brokerConnectionId", ticker, quantity, "avgCostBasis", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), connectionId, holding.ticker, holding.quantity, holding.avgCostBasis]
      );
    }

    // Update last synced time
    await pool.query(
      `UPDATE "BrokerConnection" SET "lastSyncedAt" = NOW() WHERE id = $1`,
      [connectionId]
    );

    res.json({ message: 'Holdings synced successfully.', synced: holdings.length });
  } catch (err) {
    console.error('Broker sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync holdings.' });
  }
});

// GET /api/broker/status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, provider, "lastSyncedAt" FROM "BrokerConnection" WHERE "userId" = $1`,
      [req.userId]
    );
    res.json({ connected: result.rows.length > 0, connections: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch broker status.' });
  }
});

module.exports = router;