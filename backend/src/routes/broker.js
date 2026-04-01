const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const requireAuth = require('../middleware/auth');
const {
  registerSnaptradeUser, deleteSnaptradeUser,
  generateConnectionLink, getAllHoldings,
} = require('../services/snaptrade');
const { evaluateAchievements } = require('../lib/achievementEngine');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT "snaptradeSecret", "snaptradeUserId" FROM "User" WHERE id = $1`,
      [req.userId]
    );
    let userSecret = userResult.rows[0]?.snaptradeSecret;
    let snaptradeUserId = userResult.rows[0]?.snaptradeUserId || req.userId;

    if (!userSecret) {
      const snaptradeUser = await registerSnaptradeUser(snaptradeUserId);
      if (snaptradeUser && snaptradeUser.userSecret) {
        userSecret = snaptradeUser.userSecret;
        await pool.query(
          `UPDATE "User" SET "snaptradeSecret" = $1, "snaptradeUserId" = $2 WHERE id = $3`,
          [userSecret, snaptradeUserId, req.userId]
        );
      } else {
        return res.status(400).json({ error: 'broker_account_conflict', message: 'Please use the reset endpoint.' });
      }
    }

    const connectionData = await generateConnectionLink(snaptradeUserId, userSecret);
    res.json({ redirectUri: connectionData.redirectURI });
  } catch (err) {
    console.error('Broker connect error:', err?.status, err?.responseBody?.code, err?.message);
    res.status(500).json({ error: 'Failed to initiate broker connection.' });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT "snaptradeSecret", "snaptradeUserId" FROM "User" WHERE id = $1`,
      [req.userId]
    );
    const userSecret = userResult.rows[0]?.snaptradeSecret;
    const snaptradeUserId = userResult.rows[0]?.snaptradeUserId || req.userId;

    if (!userSecret) {
      return res.status(400).json({ error: 'No broker connected. Please connect a broker first.' });
    }

    const holdings = await getAllHoldings(snaptradeUserId, userSecret);
    if (holdings.length === 0) return res.json({ message: 'No holdings found.', synced: 0 });

    let connectionResult = await pool.query(
      `SELECT id FROM "BrokerConnection" WHERE "userId" = $1 AND provider = 'snaptrade'`,
      [req.userId]
    );

    let connectionId;
    if (connectionResult.rows.length === 0) {
      const newConn = await pool.query(
        `INSERT INTO "BrokerConnection" (id, "userId", provider, "encryptedToken", "accountId")
         VALUES ($1, $2, 'snaptrade', $3, 'multiple') RETURNING id`,
        [uuidv4(), req.userId, userSecret]
      );
      connectionId = newConn.rows[0].id;
    } else {
      connectionId = connectionResult.rows[0].id;
    }

    await pool.query(`DELETE FROM "Holding" WHERE "brokerConnectionId" = $1`, [connectionId]);

    for (const holding of holdings) {
      if (!holding.ticker) continue;
      await pool.query(
        `INSERT INTO "Holding" (id, "brokerConnectionId", ticker, quantity, "avgCostBasis", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), connectionId, holding.ticker, holding.quantity, holding.avgCostBasis]
      );
    }

    await pool.query(`UPDATE "BrokerConnection" SET "lastSyncedAt" = NOW() WHERE id = $1`, [connectionId]);

    // Achievement hook
    try {
      await evaluateAchievements(req.userId, {
        brokerSynced: true,
        holdingsCount: holdings.length,
      });
    } catch (e) {
      console.error('Broker achievement error:', e.message);
    }

    res.json({ message: 'Holdings synced successfully.', synced: holdings.length });
  } catch (err) {
    console.error('Broker sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync holdings.' });
  }
});

router.post('/reset', requireAuth, async (req, res) => {
  try {
    console.log('--- BROKER RESET START for userId:', req.userId);
    const userResult = await pool.query(
      `SELECT "snaptradeSecret", "snaptradeUserId" FROM "User" WHERE id = $1`,
      [req.userId]
    );
    const existingSecret = userResult.rows[0]?.snaptradeSecret;
    const existingSnaptradeId = userResult.rows[0]?.snaptradeUserId;

    if (existingSecret && existingSnaptradeId) {
      try {
        await deleteSnaptradeUser(existingSnaptradeId, existingSecret);
      } catch (deleteErr) {
        console.log('Delete failed (ok):', deleteErr?.status, deleteErr?.responseBody?.code);
      }
    }

    await pool.query(`UPDATE "User" SET "snaptradeSecret" = NULL, "snaptradeUserId" = NULL WHERE id = $1`, [req.userId]);
    await pool.query(`DELETE FROM "BrokerConnection" WHERE "userId" = $1 AND provider = 'snaptrade'`, [req.userId]);

    const rand = Math.random().toString(36).substring(2, 8);
    const snaptradeUserId = `u${Date.now()}${rand}`;
    const snaptradeUser = await registerSnaptradeUser(snaptradeUserId);

    if (!snaptradeUser?.userSecret) {
      return res.status(500).json({ error: 'Could not re-register with broker. Please try again.' });
    }

    await pool.query(
      `UPDATE "User" SET "snaptradeSecret" = $1, "snaptradeUserId" = $2 WHERE id = $3`,
      [snaptradeUser.userSecret, snaptradeUserId, req.userId]
    );

    const connectionData = await generateConnectionLink(snaptradeUserId, snaptradeUser.userSecret);
    console.log('--- BROKER RESET COMPLETE');
    res.json({ redirectUri: connectionData.redirectURI, message: 'Reset successful.' });
  } catch (err) {
    console.error('Broker reset error:', err?.status, err?.responseBody?.code, err?.message);
    res.status(500).json({ error: 'Failed to reset broker connection.' });
  }
});

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