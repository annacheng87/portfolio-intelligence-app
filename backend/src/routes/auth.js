const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { Pool }   = require('pg');
const { v4: uuidv4 } = require('uuid');
const passport   = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const sgMail     = require('@sendgrid/mail');
const requireAuth = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ─── Google OAuth setup ───────────────────────────────────────────────────────

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email       = profile.emails?.[0]?.value;
    const displayName = profile.displayName || email;
    const googleId    = profile.id;

    if (!email) return done(new Error('No email from Google'), null);

    let result = await pool.query(
      `SELECT * FROM "User" WHERE "googleId" = $1 OR email = $2 LIMIT 1`,
      [googleId, email]
    );
    let user = result.rows[0];

    if (user) {
      if (!user.googleId) {
        await pool.query(
          `UPDATE "User" SET "googleId" = $1 WHERE id = $2`,
          [googleId, user.id]
        );
      }
    } else {
      const id = uuidv4();
      const insertResult = await pool.query(
        `INSERT INTO "User" (id, email, "hashedPassword", "displayName", "googleId")
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, email, '', displayName, googleId]
      );
      user = insertResult.rows[0];
    }

    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query(`SELECT * FROM "User" WHERE id = $1`, [id]);
    done(null, result.rows[0]);
  } catch (err) { done(err, null); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmailCode(email, code) {
  await sgMail.send({
    to:      email,
    from:    process.env.FROM_EMAIL,
    subject: 'Your TrendEdge verification code',
    text:    `Your TrendEdge verification code is: ${code}. It expires in 10 minutes.`,
    html:    `
      <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#f9f9f8;border-radius:12px">
        <div style="text-align:center;font-size:11px;font-weight:600;color:#888;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:24px">TrendEdge AI</div>
        <p style="margin:0 0 8px;font-size:15px;color:#333">Your verification code is:</p>
        <div style="text-align:center;font-size:36px;font-weight:700;letter-spacing:0.3em;color:#1a1a18;background:#fff;border:1px solid #e5e5e3;border-radius:10px;padding:20px;margin:16px 0">${code}</div>
        <p style="margin:0;font-size:13px;color:#888;text-align:center">This code expires in 10 minutes.<br/>If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

function issueToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ─── Google OAuth routes ──────────────────────────────────────────────────────

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.APP_URL}/login?error=google`, session: false }),
  (req, res) => {
    const token = issueToken(req.user.id);
    const user  = {
      id:          req.user.id,
      email:       req.user.email,
      displayName: req.user.displayName,
    };
    const params = new URLSearchParams({ token, user: JSON.stringify(user) });
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?${params.toString()}`);
  }
);

// ─── Register ─────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body;

  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'Email, password, and display name are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM "User" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuidv4();

    const result = await pool.query(
      `INSERT INTO "User" (id, email, "hashedPassword", "displayName")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, email, hashedPassword, displayName]
    );
    const user = result.rows[0];

    // Send 2FA code to email
    const code   = generateCode();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE "User" SET "twoFactorCode" = $1, "twoFactorExpiry" = $2 WHERE id = $3`,
      [code, expiry, user.id]
    );

    try {
      await sendEmailCode(email, code);
    } catch (emailErr) {
      console.error('2FA email error on register:', emailErr.message);
    }

    return res.status(201).json({
      requires2FA: true,
      userId:      user.id,
      message:     'Account created. Check your email for a verification code.',
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query('SELECT * FROM "User" WHERE email = $1', [email]);
    const user   = result.rows[0];

    if (!user || !user.hashedPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.hashedPassword);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate and send 2FA code to email
    const code   = generateCode();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE "User" SET "twoFactorCode" = $1, "twoFactorExpiry" = $2 WHERE id = $3`,
      [code, expiry, user.id]
    );

    await sendEmailCode(user.email, code);

    return res.json({
      requires2FA: true,
      userId:      user.id,
      message:     'Check your email for a verification code.',
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── Verify 2FA ───────────────────────────────────────────────────────────────

router.post('/verify-2fa', async (req, res) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    return res.status(400).json({ error: 'userId and code are required.' });
  }

  try {
    const result = await pool.query(`SELECT * FROM "User" WHERE id = $1`, [userId]);
    const user   = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (!user.twoFactorCode || !user.twoFactorExpiry) {
      return res.status(400).json({ error: 'No verification code on file. Please log in again.' });
    }
    if (new Date() > new Date(user.twoFactorExpiry)) {
      return res.status(400).json({ error: 'Code has expired. Please log in again.' });
    }
    if (user.twoFactorCode !== code.trim()) {
      return res.status(401).json({ error: 'Incorrect code. Please try again.' });
    }

    // Clear the code
    await pool.query(
      `UPDATE "User" SET "twoFactorCode" = NULL, "twoFactorExpiry" = NULL WHERE id = $1`,
      [user.id]
    );

    const token = issueToken(user.id);
    return res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (err) {
    console.error('VERIFY 2FA ERROR:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── Resend 2FA ───────────────────────────────────────────────────────────────

router.post('/resend-2fa', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    const result = await pool.query(`SELECT * FROM "User" WHERE id = $1`, [userId]);
    const user   = result.rows[0];

    if (!user) return res.status(404).json({ error: 'User not found.' });

    const code   = generateCode();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE "User" SET "twoFactorCode" = $1, "twoFactorExpiry" = $2 WHERE id = $3`,
      [code, expiry, user.id]
    );

    await sendEmailCode(user.email, code);
    return res.json({ message: 'Code resent.' });
  } catch (err) {
    console.error('RESEND 2FA ERROR:', err);
    return res.status(500).json({ error: 'Failed to resend code.' });
  }
});

// ─── Me ───────────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, "displayName", "leaderboardOptIn", "createdAt"
       FROM "User" WHERE id = $1`,
      [req.userId]
    );
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('ME ERROR:', err);
    return res.status(500).json({ error: 'Could not fetch user.' });
  }
});

// ─── Delete account ───────────────────────────────────────────────────────────

router.delete('/account', requireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM "Alert"             WHERE "userId" = $1`, [req.userId]);
    await pool.query(`DELETE FROM "AlertPreference"   WHERE "userId" = $1`, [req.userId]);
    await pool.query(`DELETE FROM "WatchlistItem"     WHERE "userId" = $1`, [req.userId]);
    await pool.query(`DELETE FROM "PortfolioSnapshot" WHERE "userId" = $1`, [req.userId]);
    await pool.query(`DELETE FROM "Friendship"        WHERE "userId" = $1 OR "friendId" = $1`, [req.userId]);
    await pool.query(`DELETE FROM "FriendCode"        WHERE "userId" = $1`, [req.userId]);

    const bc = await pool.query(
      `SELECT id FROM "BrokerConnection" WHERE "userId" = $1`, [req.userId]
    );
    for (const conn of bc.rows) {
      await pool.query(`DELETE FROM "Holding" WHERE "brokerConnectionId" = $1`, [conn.id]);
    }
    await pool.query(`DELETE FROM "BrokerConnection" WHERE "userId" = $1`, [req.userId]);
    await pool.query(`DELETE FROM "User"              WHERE id = $1`,       [req.userId]);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE ACCOUNT ERROR:', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

module.exports = router;