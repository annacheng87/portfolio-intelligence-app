const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { nanoid } = require('nanoid');
const { v4: uuidv4 } = require('uuid');
const requireAuth = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// GET /api/friends/code — get or generate your invite code
router.get('/code', requireAuth, async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT code FROM "FriendCode" WHERE "userId" = $1`,
      [req.userId]
    );

    if (existing.rows.length > 0) {
      return res.json({ code: existing.rows[0].code });
    }

    // Generate a new code, retry on collision (extremely rare)
    let code, inserted = false;
    while (!inserted) {
      code = nanoid(8).toUpperCase();
      try {
        await pool.query(
          `INSERT INTO "FriendCode" (id, "userId", code) VALUES ($1, $2, $3)`,
          [uuidv4(), req.userId, code]
        );
        inserted = true;
      } catch (e) {
        if (e.code !== '23505') throw e; // re-throw if not unique violation
      }
    }

    res.json({ code });
  } catch (err) {
    console.error('GET CODE ERROR:', err);
    res.status(500).json({ error: 'Failed to get invite code.' });
  }
});

// POST /api/friends/redeem — redeem a friend code
router.post('/redeem', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code is required.' });

  try {
    // Look up the code
    const codeResult = await pool.query(
      `SELECT "userId" FROM "FriendCode" WHERE code = $1`,
      [code.toUpperCase()]
    );
    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code.' });
    }

    const friendId = codeResult.rows[0].userId;

    if (friendId === req.userId) {
      return res.status(400).json({ error: "That's your own code." });
    }

    // Check if already friends
    const alreadyFriends = await pool.query(
      `SELECT id FROM "Friendship" WHERE "userId" = $1 AND "friendId" = $2`,
      [req.userId, friendId]
    );
    if (alreadyFriends.rows.length > 0) {
      return res.status(400).json({ error: 'Already friends.' });
    }

    // Create bidirectional friendship
    await pool.query(
      `INSERT INTO "Friendship" (id, "userId", "friendId") VALUES ($1, $2, $3), ($4, $5, $6)`,
      [uuidv4(), req.userId, friendId, uuidv4(), friendId, req.userId]
    );

    // Return the new friend's display info
    const friendResult = await pool.query(
      `SELECT id, "displayName" FROM "User" WHERE id = $1`,
      [friendId]
    );

    res.json({ success: true, friend: friendResult.rows[0] });
  } catch (err) {
    console.error('REDEEM ERROR:', err);
    res.status(500).json({ error: 'Failed to redeem code.' });
  }
});

// GET /api/friends/leaderboard — friends leaderboard (opted-in only) + yourself
// IMPORTANT: must be registered BEFORE /:friendId to avoid route collision
router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    // Get all friend IDs
    const friendsResult = await pool.query(
      `SELECT "friendId" FROM "Friendship" WHERE "userId" = $1`,
      [req.userId]
    );
    const friendIds = friendsResult.rows.map(r => r.friendId);

    // Include self
    const userIds = [req.userId, ...friendIds];

    // Get opted-in users from that set
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
    const usersResult = await pool.query(
      `SELECT id, "displayName" FROM "User"
       WHERE id IN (${placeholders}) AND "leaderboardOptIn" = true`,
      userIds
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
    console.error('FRIENDS LEADERBOARD ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch friends leaderboard.' });
  }
});

// GET /api/friends — list your friends
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u."displayName", u."leaderboardOptIn"
       FROM "Friendship" f
       JOIN "User" u ON u.id = f."friendId"
       WHERE f."userId" = $1
       ORDER BY u."displayName" ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET FRIENDS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch friends.' });
  }
});

// DELETE /api/friends/:friendId — remove a friend (bidirectional)
router.delete('/:friendId', requireAuth, async (req, res) => {
  const { friendId } = req.params;
  try {
    await pool.query(
      `DELETE FROM "Friendship"
       WHERE ("userId" = $1 AND "friendId" = $2)
          OR ("userId" = $2 AND "friendId" = $1)`,
      [req.userId, friendId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('REMOVE FRIEND ERROR:', err);
    res.status(500).json({ error: 'Failed to remove friend.' });
  }
});

module.exports = router;