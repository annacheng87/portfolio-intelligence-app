// src/lib/achievements.js

const ACHIEVEMENTS = [
  {
    key: 'broker_sync',
    label: 'Connected',
    description: 'Sync your broker for the first time',
    xp: 50,
    icon: '🔗',
    category: 'Setup',
  },
  {
    key: 'first_order',
    label: 'First Trade',
    description: 'Place your very first order',
    xp: 100,
    icon: '📈',
    category: 'Trading',
  },
  {
    key: 'first_profit',
    label: 'In The Green',
    description: 'Close your first profitable trade',
    xp: 150,
    icon: '💰',
    category: 'Trading',
  },
  {
    key: 'streak_3',
    label: '3-Day Streak',
    description: 'Log in 3 days in a row',
    xp: 150,
    icon: '🔥',
    category: 'Consistency',
  },
  {
    key: 'streak_7',
    label: 'Week Warrior',
    description: 'Log in 7 days in a row',
    xp: 300,
    icon: '⚡',
    category: 'Consistency',
  },
  {
    key: 'streak_30',
    label: 'Monthly Grinder',
    description: 'Log in 30 days in a row',
    xp: 1000,
    icon: '🏆',
    category: 'Consistency',
  },
  {
    key: 'active_30',
    label: '30-Day Active',
    description: 'Log in for 30 total days',
    xp: 500,
    icon: '📅',
    category: 'Consistency',
  },
  {
    key: 'hold_5_tickers',
    label: 'Diversified',
    description: 'Hold 5 or more different tickers',
    xp: 200,
    icon: '🎯',
    category: 'Portfolio',
  },
  {
    key: 'watchlist_10',
    label: 'Watchlist Pro',
    description: 'Add 10 tickers to your watchlist',
    xp: 75,
    icon: '👁️',
    category: 'Portfolio',
  },
  {
    key: 'top_10_leaderboard',
    label: 'Top 10',
    description: 'Reach the top 10 on the leaderboard',
    xp: 500,
    icon: '🥇',
    category: 'Social',
  },
  {
    key: 'invite_friend',
    label: 'Squad Goals',
    description: 'Invite a friend via your invite code',
    xp: 250,
    icon: '👥',
    category: 'Social',
  },
  {
    key: 'portfolio_1k',
    label: 'First $1K',
    description: 'Portfolio reaches $1,000',
    xp: 100,
    icon: '💵',
    category: 'Milestones',
  },
  {
    key: 'portfolio_10k',
    label: 'Five Figures',
    description: 'Portfolio reaches $10,000',
    xp: 300,
    icon: '💎',
    category: 'Milestones',
  },
  {
    key: 'portfolio_100k',
    label: 'Six Figures',
    description: 'Portfolio reaches $100,000',
    xp: 1000,
    icon: '🚀',
    category: 'Milestones',
  },
];

// Progress hints for unearned achievements — shown in hybrid mystery mode
const PROGRESS_HINTS = {
  broker_sync:         { category: 'Setup', hint: 'Connect a broker' },
  first_order:         { category: 'Trading', hint: 'Place an order' },
  first_profit:        { category: 'Trading', hint: 'Make a profitable trade' },
  streak_3:            { category: 'Consistency', hint: 'Log in consistently' },
  streak_7:            { category: 'Consistency', hint: 'Log in consistently' },
  streak_30:           { category: 'Consistency', hint: 'Log in consistently' },
  active_30:           { category: 'Consistency', hint: 'Keep logging in' },
  hold_5_tickers:      { category: 'Portfolio', hint: 'Diversify your holdings' },
  watchlist_10:        { category: 'Portfolio', hint: 'Build your watchlist' },
  top_10_leaderboard:  { category: 'Social', hint: 'Climb the leaderboard' },
  invite_friend:       { category: 'Social', hint: 'Invite someone' },
  portfolio_1k:        { category: 'Milestones', hint: 'Grow your portfolio' },
  portfolio_10k:       { category: 'Milestones', hint: 'Grow your portfolio' },
  portfolio_100k:      { category: 'Milestones', hint: 'Grow your portfolio' },
};

const TIERS = [
  { name: 'Bronze',   minXp: 0,    color: '#cd7f32' },
  { name: 'Silver',   minXp: 500,  color: '#c0c0c0' },
  { name: 'Gold',     minXp: 1500, color: '#ffd700' },
  { name: 'Platinum', minXp: 3000, color: '#e5e4e2' },
  { name: 'Diamond',  minXp: 6000, color: '#b9f2ff' },
];

function getTierInfo(xp) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (xp >= t.minXp) tier = t;
  }
  const idx = TIERS.indexOf(tier);
  const next = TIERS[idx + 1] || null;
  return {
    tier: tier.name,
    tierColor: tier.color,
    nextTier: next ? next.name : null,
    nextTierColor: next ? next.color : null,
    xpToNext: next ? next.minXp - xp : 0,
    currentTierMinXp: tier.minXp,
    nextTierMinXp: next ? next.minXp : null,
  };
}

// Floor XP to current tier minimum (for decay — can't drop below tier floor)
// NOTE: per user decision, decay CAN drop tiers, so no floor is enforced
function applyDecay(currentXp, daysMissed) {
  if (daysMissed <= 7) return currentXp;
  const decayDays = daysMissed - 7;
  let xp = currentXp;
  for (let i = 0; i < decayDays; i++) {
    xp = Math.floor(xp * 0.9); // 10% per day
    if (xp <= 0) { xp = 0; break; }
  }
  return xp;
}

// Weekly challenge pool — rotates deterministically by week number
const CHALLENGE_POOL = [
  { key: 'place_3_orders',    label: 'Active Trader',     description: 'Place 3 orders this week',           xpReward: 200 },
  { key: 'check_in_5_days',   label: 'Consistent',        description: 'Log in 5 days this week',            xpReward: 150 },
  { key: 'add_3_watchlist',   label: 'Scout',             description: 'Add 3 tickers to your watchlist',    xpReward: 100 },
  { key: 'top_5_leaderboard', label: 'Competitor',        description: 'Reach top 5 on the leaderboard',     xpReward: 300 },
  { key: 'sync_broker',       label: 'Synced Up',         description: 'Sync your broker holdings',          xpReward: 75  },
  { key: 'invite_someone',    label: 'Recruiter',         description: 'Invite a new friend this week',      xpReward: 250 },
  { key: 'hold_diverse',      label: 'Diversify',         description: 'Hold at least 3 different tickers',  xpReward: 125 },
];

function getWeeklyChallenges() {
  const now = new Date();
  // Get Monday of current week
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);

  // Week number since epoch for deterministic rotation
  const weekNum = Math.floor(monday.getTime() / (7 * 24 * 60 * 60 * 1000));

  // Pick 3 challenges for this week
  const selected = [];
  for (let i = 0; i < 3; i++) {
    selected.push(CHALLENGE_POOL[(weekNum + i) % CHALLENGE_POOL.length]);
  }

  // Next Monday for countdown
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);

  return { challenges: selected, weekStart: monday, weekEnd: nextMonday };
}

module.exports = { ACHIEVEMENTS, PROGRESS_HINTS, TIERS, getTierInfo, applyDecay, getWeeklyChallenges, CHALLENGE_POOL };