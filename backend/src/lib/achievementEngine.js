// src/lib/achievementEngine.js
const prisma = require('./prisma');
const { ACHIEVEMENTS, getTierInfo, applyDecay } = require('./achievements');

/**
 * Log an XP event and update UserStats.xp
 */
async function addXp(userId, delta, reason) {
  await prisma.$transaction([
    prisma.xpEvent.create({ data: { userId, delta, reason } }),
    prisma.userStats.upsert({
      where: { userId },
      update: { xp: { increment: delta } },
      create: { userId, xp: Math.max(0, delta), streak: 0, bestStreak: 0 },
    }),
  ]);
}

/**
 * Grant an achievement if not already earned. Returns { granted, xpAwarded, achievement }
 */
async function grantAchievement(userId, key) {
  const def = ACHIEVEMENTS.find(a => a.key === key);
  if (!def) return { granted: false, xpAwarded: 0, achievement: null };

  try {
    await prisma.userAchievement.create({
      data: { userId, achievementKey: key },
    });
    await addXp(userId, def.xp, `achievement:${key}`);
    console.log(`[XP] ${userId} earned "${key}" +${def.xp} XP`);
    return { granted: true, xpAwarded: def.xp, achievement: def };
  } catch (e) {
    // @@unique violation = already earned
    return { granted: false, xpAwarded: 0, achievement: null };
  }
}

/**
 * Daily check-in: updates streak, bestStreak, applies decay if needed.
 * Returns { stats, decayedXp, newAchievements }
 */
async function dailyCheckin(userId) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  let stats = await prisma.userStats.upsert({
    where: { userId },
    update: {},
    create: { userId, xp: 0, streak: 0, bestStreak: 0 },
  });

  const lastStr = stats.lastActiveDate
    ? stats.lastActiveDate.toISOString().split('T')[0]
    : null;

  // Already checked in today
  if (lastStr === todayStr) {
    return { stats, decayedXp: 0, newAchievements: [] };
  }

  const daysMissed = lastStr
    ? Math.round((now - new Date(lastStr)) / 86400000)
    : 0;

  // Apply XP decay if missed more than 7 days
  let decayedXp = 0;
  if (daysMissed > 7) {
    const newXp = applyDecay(stats.xp, daysMissed);
    decayedXp = stats.xp - newXp;
    if (decayedXp > 0) {
      await addXp(userId, -decayedXp, `decay:${daysMissed}_days_missed`);
      stats = await prisma.userStats.findUnique({ where: { userId } });
    }
  }

  // Calculate new streak
  let newStreak;
  if (!lastStr) {
    newStreak = 1;
  } else if (daysMissed === 1) {
    newStreak = stats.streak + 1;
  } else if (daysMissed === 0) {
    newStreak = stats.streak; // same day, shouldn't reach here
  } else {
    // Check freeze
    if (stats.freezeAvailable && daysMissed === 2) {
      newStreak = stats.streak + 1; // used freeze
      await prisma.userStats.update({
        where: { userId },
        data: { freezeAvailable: false },
      });
    } else {
      newStreak = 1; // streak broken
    }
  }

  const newBest = Math.max(newStreak, stats.bestStreak);

  stats = await prisma.userStats.update({
    where: { userId },
    data: {
      streak: newStreak,
      bestStreak: newBest,
      lastActiveDate: now,
    },
  });

  // Evaluate streak achievements
  const newAchievements = [];
  if (newStreak >= 3)  { const r = await grantAchievement(userId, 'streak_3');  if (r.granted) newAchievements.push(r.achievement); }
  if (newStreak >= 7)  { const r = await grantAchievement(userId, 'streak_7');  if (r.granted) newAchievements.push(r.achievement); }
  if (newStreak >= 30) { const r = await grantAchievement(userId, 'streak_30'); if (r.granted) newAchievements.push(r.achievement); }

  return { stats, decayedXp, newAchievements };
}

/**
 * Evaluate context-based achievements after any action.
 * Returns array of newly granted achievements.
 */
async function evaluateAchievements(userId, context = {}) {
  const {
    orderPlaced,
    firstProfit,
    brokerSynced,
    watchlistCount,
    holdingsCount,
    portfolioValue,
    leaderboardRank,
    friendInvited,
  } = context;

  const results = [];

  const check = async (key) => {
    const r = await grantAchievement(userId, key);
    if (r.granted) results.push(r.achievement);
  };

  if (brokerSynced)   await check('broker_sync');
  if (orderPlaced)    await check('first_order');
  if (firstProfit)    await check('first_profit');
  if (friendInvited)  await check('invite_friend');

  if (watchlistCount >= 10) await check('watchlist_10');
  if (holdingsCount  >= 5)  await check('hold_5_tickers');

  if (portfolioValue !== undefined) {
    if (portfolioValue >= 1000)   await check('portfolio_1k');
    if (portfolioValue >= 10000)  await check('portfolio_10k');
    if (portfolioValue >= 100000) await check('portfolio_100k');
  }

  if (leaderboardRank && leaderboardRank <= 10) await check('top_10_leaderboard');

  return results;
}

module.exports = { grantAchievement, evaluateAchievements, dailyCheckin, addXp };