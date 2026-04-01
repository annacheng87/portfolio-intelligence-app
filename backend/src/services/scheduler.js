const cron = require('node-cron');
const { Pool } = require('pg');
const { evaluateWatchlists } = require('./alertEvaluator');
const { sendDailyDigestEmail, sendWeeklyDigestEmail } = require('./emailService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Daily digest builder ─────────────────────────────────────────────────────

async function runDailyDigests() {
  console.log('[scheduler] Running daily digests...');
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usersResult = await pool.query(
      `SELECT DISTINCT u.id, u.email, u."displayName"
       FROM "Alert" a
       JOIN "User" u ON a."userId" = u.id
       WHERE a."triggeredAt" >= $1`,
      [today]
    );

    console.log(`[scheduler] Sending daily digest to ${usersResult.rows.length} users`);

    for (const user of usersResult.rows) {
      const alertsResult = await pool.query(
        `SELECT * FROM "Alert"
         WHERE "userId" = $1 AND "triggeredAt" >= $2
         ORDER BY "triggeredAt" DESC`,
        [user.id, today]
      );
      const alerts = alertsResult.rows;

      const topMovers = alerts.map(a => ({
        ticker:    a.ticker,
        name:      a.ticker,
        weight:    0,
        pctChange: extractPct(a.plainEnglishSummary),
        barWidth:  Math.min(Math.abs(parseFloat(extractPct(a.plainEnglishSummary)) || 0) * 10, 100),
      }));

      const newsItems = alerts
        .filter(a => a.newsHeadline)
        .map(a => ({
          type:      'news',
          typeLabel: 'NEWS',
          ticker:    a.ticker,
          headline:  a.newsHeadline,
          source:    'Market News',
          timeAgo:   'Today',
        }));

      const worstAlert = alerts.find(a => a.alertType === 'price_down') || alerts[0];
      const riskTitle  = worstAlert ? `${worstAlert.ticker} — ${labelFromType(worstAlert.alertType)}` : 'No major risk flags today';
      const riskBody   = worstAlert?.riskNote || 'Your portfolio looks stable today.';
      const insight    = getDailyInsight();

      try {
        await sendDailyDigestEmail(user.email, {
          displayName:            user.displayName || user.email,
          portfolioDayChange:     null,
          portfolioTotalValue:    null,
          portfolioAlltimeReturn: null,
          leaderboardRank:        null,
          topMovers,
          newsItems,
          watchlistItems:         [],
          riskTitle,
          riskBody,
          leaderboardName:        'Global',
          leaderboardRows:        [],
          rankChangeLabel:        'no change',
          insightCategory:        insight.category,
          insightText:            insight.text,
        });
      } catch (emailErr) {
        console.error(`[scheduler] Daily digest failed for ${user.email}:`, emailErr.message);
      }
    }

    console.log('[scheduler] Daily digests complete.');
  } catch (err) {
    console.error('[scheduler] Daily digest error:', err.message);
  }
}

// ─── Weekly digest builder ────────────────────────────────────────────────────

async function runWeeklyDigests() {
  console.log('[scheduler] Running weekly digests...');
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const usersResult = await pool.query(
      `SELECT DISTINCT u.id, u.email, u."displayName"
       FROM "Alert" a
       JOIN "User" u ON a."userId" = u.id
       WHERE a."triggeredAt" >= $1`,
      [weekAgo]
    );

    console.log(`[scheduler] Sending weekly digest to ${usersResult.rows.length} users`);

    for (const user of usersResult.rows) {
      const alertsResult = await pool.query(
        `SELECT * FROM "Alert"
         WHERE "userId" = $1 AND "triggeredAt" >= $2
         ORDER BY "triggeredAt" DESC`,
        [user.id, weekAgo]
      );
      const alerts = alertsResult.rows;

      const tickerPcts = {};
      for (const a of alerts) {
        const pct = parseFloat(extractPct(a.plainEnglishSummary)) || 0;
        if (!tickerPcts[a.ticker] || Math.abs(pct) > Math.abs(tickerPcts[a.ticker])) {
          tickerPcts[a.ticker] = pct;
        }
      }
      const sorted          = Object.entries(tickerPcts).sort((a, b) => b[1] - a[1]);
      const bestPerformers  = sorted.filter(([, p]) => p > 0).slice(0, 3).map(([ticker, pct]) => ({ ticker, pct: `+${pct.toFixed(1)}%` }));
      const worstPerformers = sorted.filter(([, p]) => p < 0).reverse().slice(0, 3).map(([ticker, pct]) => ({ ticker, pct: `${pct.toFixed(1)}%` }));

      const newsThemes = Object.keys(tickerPcts).slice(0, 3).map((ticker, i) => {
        const tickerAlerts = alerts.filter(a => a.ticker === ticker);
        return {
          number:          String(i + 1).padStart(2, '0'),
          title:           `Activity in ${ticker} this week`,
          description:     tickerAlerts[0]?.plainEnglishSummary || '',
          affectedTickers: [ticker],
        };
      });

      const now      = new Date();
      const monday   = new Date(now); monday.setDate(now.getDate() - now.getDay() + 1);
      const friday   = new Date(monday); friday.setDate(monday.getDate() + 4);
      const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      const edu       = getWeeklyInsight();

      try {
        await sendWeeklyDigestEmail(user.email, {
          weekLabel,
          dateRange:            weekLabel,
          tradingDays:          5,
          weekPctChange:        null,
          portfolioValue:       null,
          dollarChange:         null,
          benchmarkReturn:      null,
          leaderboardRank:      null,
          rankChangeLabel:      'no change',
          alltimeReturn:        null,
          startDate:            null,
          sparkBars:            buildSparkBars(alerts),
          bestPerformers,
          worstPerformers,
          newsThemes,
          concentrationItems:   [],
          concentrationWarning: '',
          leaderboardName:      'Global',
          leaderboardRows:      [],
          eduCategory:          edu.category,
          eduTitle:             edu.title,
          eduBody:              edu.body,
        });
      } catch (emailErr) {
        console.error(`[scheduler] Weekly digest failed for ${user.email}:`, emailErr.message);
      }
    }

    console.log('[scheduler] Weekly digests complete.');
  } catch (err) {
    console.error('[scheduler] Weekly digest error:', err.message);
  }
}

// ─── Alert cleanup ────────────────────────────────────────────────────────────

async function runAlertCleanup() {
  console.log('[scheduler] Running monthly alert cleanup...');
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const result = await pool.query(
      `DELETE FROM "Alert" WHERE "triggeredAt" < $1`,
      [cutoff]
    );

    console.log(`[scheduler] Deleted ${result.rowCount} alerts older than 30 days.`);
  } catch (err) {
    console.error('[scheduler] Alert cleanup error:', err.message);
  }
}





// ─── Main scheduler ───────────────────────────────────────────────────────────

function startScheduler() {
  const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { applyDecay } = require('../lib/achievements');
const { addXp } = require('../lib/achievementEngine');

// XP Decay cron — runs daily at midnight ET
cron.schedule('0 0 * * *', async () => {
  console.log('[Cron] Running XP decay check...');
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Find all users who haven't checked in for 7+ days
    const staleUsers = await prisma.userStats.findMany({
      where: {
        lastActiveDate: {
          lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        },
        xp: { gt: 0 },
      },
    });

    for (const stats of staleUsers) {
      const daysMissed = stats.lastActiveDate
        ? Math.round((now - new Date(stats.lastActiveDate)) / 86400000)
        : 999;

      if (daysMissed <= 7) continue;

      // Apply one day of decay (10%)
      const decayAmount = Math.floor(stats.xp * 0.1);
      if (decayAmount > 0) {
        await addXp(stats.userId, -decayAmount, `decay:cron:${todayStr}`);
        console.log(`[Cron] Decayed ${decayAmount} XP from user ${stats.userId}`);
      }
    }
  } catch (err) {
    console.error('[Cron] XP decay error:', err);
  }
}, { timezone: 'America/New_York' });

  console.log('Starting alert scheduler...');

  // Run evaluator immediately on startup
  evaluateWatchlists().catch(err => {
    console.error('Initial evaluation error:', err);
  });

  // Real-time alert checks — every 15 min during market hours Mon–Fri
  cron.schedule('*/15 9-16 * * 1-5', async () => {
    console.log('Scheduled check at', new Date().toISOString());
    try {
      await evaluateWatchlists();
    } catch (err) {
      console.error('Scheduled evaluator error:', err);
    }
  }, { timezone: 'America/New_York' });

  // Daily digest — 6:00 PM ET Mon–Fri
  cron.schedule('0 18 * * 1-5', async () => {
    console.log('[scheduler] 6 PM digest trigger at', new Date().toISOString());
    await runDailyDigests();
  }, { timezone: 'America/New_York' });

  // Weekly digest — 9:00 AM ET Saturday
  cron.schedule('0 9 * * 6', async () => {
    console.log('[scheduler] Saturday digest trigger at', new Date().toISOString());
    await runWeeklyDigests();
  }, { timezone: 'America/New_York' });

  // Alert cleanup — 2:00 AM ET on the 1st of every month
  cron.schedule('0 2 1 * *', async () => {
    console.log('[scheduler] Monthly cleanup trigger at', new Date().toISOString());
    await runAlertCleanup();
  }, { timezone: 'America/New_York' });

  setInterval(() => {}, 1 << 30);

  console.log('Scheduler running:');
  console.log('  — Alert checks:   every 15 min, 9 AM–4 PM ET Mon–Fri');
  console.log('  — Daily digest:   6:00 PM ET Mon–Fri');
  console.log('  — Weekly digest:  9:00 AM ET Saturday');
  console.log('  — Alert cleanup:  2:00 AM ET on the 1st of every month');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPct(summary) {
  if (!summary) return '0';
  const match = summary.match(/([\+\-]?\d+\.?\d*)%/);
  return match ? match[1] : '0';
}

function labelFromType(type) {
  if (type === 'price_up')     return 'Up move today';
  if (type === 'price_down')   return 'Down move today';
  if (type === 'volume_spike') return 'Volume spike';
  return 'Alert';
}

function buildSparkBars(alerts) {
  const days = [0, 0, 0, 0, 0];
  for (const a of alerts) {
    const d = new Date(a.triggeredAt).getDay();
    if (d >= 1 && d <= 5) {
      const pct = parseFloat(extractPct(a.plainEnglishSummary)) || 0;
      days[d - 1] += pct;
    }
  }
  const maxAbs = Math.max(...days.map(Math.abs), 1);
  return days.map(val => ({
    height: Math.max(Math.round((Math.abs(val) / maxAbs) * 100), 8),
    color:  val >= 0 ? '#10B981' : '#F87171',
  }));
}

const DAILY_INSIGHTS = [
  { category: 'Risk management',    text: 'When a single stock exceeds 20% of your portfolio, a 10% drop moves your entire portfolio by 2%. This is concentration risk — and why diversification matters even if you\'re bullish on a name.' },
  { category: 'Market basics',      text: 'Volume is how many shares traded in a day. High volume on a big price move means more conviction — institutions are involved. High volume on a flat day often means nothing.' },
  { category: 'Behavioural finance', text: 'Studies show investors feel losses about twice as strongly as equivalent gains. This is called loss aversion — and it\'s one reason people sell too early after a drop and hold too long after a gain.' },
  { category: 'Portfolio basics',   text: 'Diversification doesn\'t mean owning many stocks. If all your stocks move together in the same direction, you\'re not diversified. True diversification means owning things that don\'t all fall at the same time.' },
  { category: 'Reading the market', text: 'The S&P 500 is an index of 500 large US companies. When people say "the market is up today", they usually mean the S&P 500 is up. It\'s the most common benchmark to compare your portfolio against.' },
];

const WEEKLY_INSIGHTS = [
  { category: 'Portfolio basics', title: 'What does it mean to outperform the market?', body: 'Outperforming the S&P 500 means your portfolio grew faster than the index over the same period. Most professional fund managers don\'t beat it consistently — so if you do, even briefly, that\'s meaningful.' },
  { category: 'Risk management',  title: 'Why drawdowns matter more than gains',        body: 'A 50% loss requires a 100% gain just to break even. This asymmetry is why protecting your downside is more important than chasing upside. Slow and steady portfolios often win long-term.' },
  { category: 'Market basics',    title: 'What earnings season means for your portfolio', body: 'Four times a year, public companies report their financials. These reports often cause big price swings — even if the numbers look fine, the market reacts to whether results beat or missed expectations.' },
];

function getDailyInsight() {
  return DAILY_INSIGHTS[new Date().getDay() % DAILY_INSIGHTS.length];
}

function getWeeklyInsight() {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_INSIGHTS[week % WEEKLY_INSIGHTS.length];
}

module.exports = { startScheduler };