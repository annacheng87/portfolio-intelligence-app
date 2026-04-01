// src/routes/stats.js
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { ACHIEVEMENTS, PROGRESS_HINTS, getTierInfo, getWeeklyChallenges } = require('../lib/achievements');
const { dailyCheckin, evaluateAchievements } = require('../lib/achievementEngine');

// GET /api/stats — full stats payload
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;

    const stats = await prisma.userStats.upsert({
      where: { userId },
      update: {},
      create: { userId, xp: 0, streak: 0, bestStreak: 0 },
    });

    const earned = await prisma.userAchievement.findMany({ where: { userId } });
    const earnedMap = new Map(earned.map(a => [a.achievementKey, a.earnedAt]));

    const tierInfo = getTierInfo(stats.xp);

    // Build achievements list with hybrid mystery for unearned
    const achievements = ACHIEVEMENTS.map(def => {
      const isEarned = earnedMap.has(def.key);
      const hint = PROGRESS_HINTS[def.key];
      return {
        key: def.key,
        icon: isEarned ? def.icon : '🔒',
        label: isEarned ? def.label : hint.category,
        description: isEarned ? def.description : hint.hint,
        xp: def.xp,
        category: def.category,
        earned: isEarned,
        earnedAt: isEarned ? earnedMap.get(def.key) : null,
      };
    });

    // XP feed (last 20 events)
    const xpEvents = await prisma.xpEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Weekly challenges
    const { challenges, weekStart, weekEnd } = getWeeklyChallenges();
    const completedChallenges = await prisma.userWeeklyChallenge.findMany({
      where: { userId, weekStart },
    });
    const completedKeys = new Set(completedChallenges.map(c => c.challengeKey));
    const challengesWithStatus = challenges.map(c => ({
      ...c,
      completed: completedKeys.has(c.key),
    }));

    res.json({
      xp: stats.xp,
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      freezeAvailable: stats.freezeAvailable,
      ...tierInfo,
      achievements,
      xpFeed: xpEvents,
      weeklyChallenges: challengesWithStatus,
      weekEnd: weekEnd.toISOString(),
    });
  } catch (err) {
    console.error('STATS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /api/stats/checkin — call on dashboard load
router.post('/checkin', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { stats, decayedXp, newAchievements } = await dailyCheckin(userId);
    const tierInfo = getTierInfo(stats.xp);

    res.json({
      xp: stats.xp,
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      freezeAvailable: stats.freezeAvailable,
      ...tierInfo,
      decayedXp,
      newAchievements,
    });
  } catch (err) {
    console.error('CHECKIN ERROR:', err);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

module.exports = router;