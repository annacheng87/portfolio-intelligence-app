require('dotenv').config();
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_ALERTS  = { email: process.env.FROM_EMAIL || 'alerts@trendedge.ai',  name: 'TrendEdge AI' };
const FROM_DIGEST  = { email: process.env.FROM_DIGEST || 'digest@trendedge.ai',  name: 'TrendEdge AI' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function alertColor(alertType) {
  if (alertType === 'price_up')     return 'positive';
  if (alertType === 'price_down')   return 'danger';
  if (alertType === 'volume_spike') return 'warning';
  return 'info';
}

function alertLabel(alertType) {
  if (alertType === 'price_up')     return 'Holding Move — Up';
  if (alertType === 'price_down')   return 'Holding Move — Down';
  if (alertType === 'volume_spike') return 'Unusual Volume Spike';
  return 'Portfolio Alert';
}

function riskClass(riskNote) {
  if (!riskNote) return 'moderate';
  const lower = riskNote.toLowerCase();
  if (lower.includes('panic') || lower.includes('large') || lower.includes('big')) return 'high';
  if (lower.includes('temporary') || lower.includes('worth')) return 'moderate';
  return 'moderate';
}

function formatPct(pct) {
  const n = parseFloat(pct);
  if (isNaN(n)) return pct;
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

// ─── 1. Real-time alert email ─────────────────────────────────────────────────
// Called immediately after an alert row is inserted in alertEvaluator.js

async function sendRealtimeAlertEmail(userEmail, {
  ticker,
  alertType,       // 'price_up' | 'price_down' | 'volume_spike'
  pctChange,       // number, e.g. -6.2
  currentPrice,    // number, e.g. 218.40
  priceChange,     // number, e.g. -14.42
  portfolioWeight, // number, e.g. 18  (% of portfolio — pass 0 if watchlist-only)
  positionValue,   // string, e.g. '$9,828'
  plainEnglishSummary,
  riskNote,
  newsHeadline,
  newsUrl,
  redditTitle,
  redditUrl,
  exchange = 'NYSE/NASDAQ',
  sector   = '',
}) {
  const color = alertColor(alertType);
  const label = alertLabel(alertType);
  const now   = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const date  = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Build insight bullets from available data
  const insights = [];
  if (newsHeadline) insights.push(`News: ${newsHeadline}`);
  if (redditTitle)  insights.push(`Reddit: "${redditTitle}"`);
  if (Math.abs(pctChange) >= 5) insights.push(`Move of ${Math.abs(pctChange).toFixed(1)}% is significant — above the 5% alert threshold`);
  if (insights.length === 0)    insights.push('No additional signals detected at this time');

  // Considerations
  const considerations = [
    riskNote || `Review your position in ${ticker} in context of your overall portfolio`,
    portfolioWeight >= 10
      ? `${ticker} is ${portfolioWeight}% of your portfolio — a meaningful exposure`
      : `Monitor for follow-through over the next 1–2 trading days`,
  ];

  const appUrl        = process.env.APP_URL        || 'https://trendedge.ai';
  const breakdownUrl  = `${appUrl}/alerts/${ticker.toLowerCase()}`;
  const portfolioUrl  = `${appUrl}/portfolio`;
  const prefsUrl      = `${appUrl}/settings/alerts`;
  const unsubUrl      = `${appUrl}/unsubscribe?email=${encodeURIComponent(userEmail)}`;

  const dynamicTemplateData = {
    app_url:          appUrl,
    breakdown_url:    breakdownUrl,
    portfolio_url:    portfolioUrl,
    preferences_url:  prefsUrl,
    unsubscribe_url:  unsubUrl,
    user_email:       userEmail,

    alert_band_class:  color,
    alert_color:       color,
    alert_type_label:  label,
    alert_time:        now,

    ticker,
    exchange,
    sector,

    headline:     buildHeadline(ticker, alertType, pctChange),
    headline_sub: `${date} · $${Number(currentPrice).toFixed(2)} per share`,

    current_price:     Number(currentPrice).toFixed(2),
    price_change:      priceChange ? Number(priceChange).toFixed(2) : '—',
    pct_change:        pctChange   ? Number(pctChange).toFixed(1)   : '—',
    portfolio_weight:  portfolioWeight || 0,
    position_value:    positionValue   || '—',
    bar_color:         color === 'positive' ? '#10B981' : color === 'danger' ? '#F87171' : '#F59E0B',

    why_it_matters:   plainEnglishSummary,
    insights,

    risk_level_class:  riskClass(riskNote),
    risk_level_label:  riskClass(riskNote) === 'high' ? 'High' : 'Moderate',
    risk_description:  riskNote || 'Monitor closely over the next trading session',

    considerations,
  };

  await sgMail.send({
    to:   userEmail,
    from: FROM_ALERTS,
    templateId:          process.env.SENDGRID_TEMPLATE_REALTIME,
    dynamicTemplateData,
  });

  console.log(`[emailService] Real-time alert sent → ${userEmail} (${ticker} ${alertType})`);
}

// ─── 2. Daily digest email ────────────────────────────────────────────────────
// Called by the scheduler at ~6 PM ET, Mon–Fri

async function sendDailyDigestEmail(userEmail, {
  displayName,
  portfolioDayChange,   // e.g. '-1.8%'
  portfolioTotalValue,  // e.g. '$42,180'
  portfolioAlltimeReturn, // e.g. '+12.4%'
  leaderboardRank,      // number
  topMovers,            // array: [{ ticker, name, weight, pctChange, barWidth }]
  newsItems,            // array: [{ type, typeLabel, ticker, headline, source, timeAgo }]
  watchlistItems,       // array: [{ ticker, event, pctChange }]
  riskTitle,
  riskBody,
  leaderboardName,
  leaderboardRows,      // array: [{ rank, displayName, weeklyReturn, isYou, moveLabel }]
  rankChangeLabel,
  insightCategory,
  insightText,
}) {
  const now  = new Date();
  const dateFull = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const dateShort = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const appUrl   = process.env.APP_URL || 'https://trendedge.ai';
  const prefsUrl = `${appUrl}/settings/alerts`;
  const unsubUrl = `${appUrl}/unsubscribe?email=${encodeURIComponent(userEmail)}`;

  // Attach CSS class helpers to arrays
  const moversWithClasses = (topMovers || []).map(m => ({
    ...m,
    pct_class: parseFloat(m.pctChange) >= 0 ? 'pct-up' : 'pct-down',
    bar_class:  parseFloat(m.pctChange) >= 0 ? 'holding-bar-up' : 'holding-bar-down',
    bar_width:  m.barWidth || Math.min(Math.abs(parseFloat(m.pctChange)) * 10, 100),
  }));

  const watchlistWithClasses = (watchlistItems || []).map(w => ({
    ...w,
    pct_class: parseFloat(w.pctChange) >= 0 ? 'pct-up' : 'pct-down',
  }));

  const leaderboardWithClasses = (leaderboardRows || []).map(r => ({
    ...r,
    pct_class:   parseFloat(r.weeklyReturn) >= 0 ? 'pct-up' : 'pct-down',
    move_class:  r.moveLabel?.includes('▲') ? 'lb-move-up' : r.moveLabel?.includes('▼') ? 'lb-move-down' : '',
  }));

  const dynamicTemplateData = {
    app_url:         appUrl,
    portfolio_url:   `${appUrl}/portfolio`,
    preferences_url: prefsUrl,
    unsubscribe_url: unsubUrl,
    user_email:      userEmail,
    send_time:       '6:00 PM',

    date_full:  dateFull,
    date_short: dateShort,

    portfolio_day_change:    portfolioDayChange    || '—',
    portfolio_day_class:     parseFloat(portfolioDayChange) >= 0 ? 'up' : 'down',
    portfolio_total_value:   portfolioTotalValue   || '—',
    portfolio_alltime_return: portfolioAlltimeReturn || '—',
    portfolio_alltime_class:  parseFloat(portfolioAlltimeReturn) >= 0 ? 'up' : 'down',
    leaderboard_rank:        leaderboardRank || '—',

    top_movers:       moversWithClasses,
    news_items:       newsItems        || [],
    watchlist_items:  watchlistWithClasses,

    risk_title: riskTitle || 'No major risk flags today',
    risk_body:  riskBody  || 'Your portfolio looks stable. Continue monitoring your positions.',

    leaderboard_name: leaderboardName || 'Global',
    leaderboard_rows: leaderboardWithClasses,
    rank_change_label: rankChangeLabel || 'no change',

    insight_category: insightCategory || 'Portfolio tip',
    insight_text:     insightText     || '',
  };

  await sgMail.send({
    to:   userEmail,
    from: FROM_DIGEST,
    templateId:          process.env.SENDGRID_TEMPLATE_DAILY,
    dynamicTemplateData,
  });

  console.log(`[emailService] Daily digest sent → ${userEmail}`);
}

// ─── 3. Weekly digest email ───────────────────────────────────────────────────
// Called by the scheduler on Saturday morning

async function sendWeeklyDigestEmail(userEmail, {
  weekLabel,
  dateRange,
  tradingDays,
  weekPctChange,
  portfolioValue,
  dollarChange,
  benchmarkReturn,
  leaderboardRank,
  rankChangeLabel,
  alltimeReturn,
  startDate,
  sparkBars,        // array of { height, color } — 5 items for Mon–Fri
  bestPerformers,   // array: [{ ticker, pct }]
  worstPerformers,  // array: [{ ticker, pct }]
  newsThemes,       // array: [{ number, title, description, affectedTickers }]
  concentrationItems, // array: [{ ticker, weight, barClass }]
  concentrationWarning,
  leaderboardName,
  leaderboardRows,
  eduCategory,
  eduTitle,
  eduBody,
}) {
  const appUrl   = process.env.APP_URL || 'https://trendedge.ai';
  const prefsUrl = `${appUrl}/settings/alerts`;
  const unsubUrl = `${appUrl}/unsubscribe?email=${encodeURIComponent(userEmail)}`;

  const leaderboardWithClasses = (leaderboardRows || []).map(r => ({
    ...r,
    pct_class: parseFloat(r.weeklyReturn) >= 0 ? 'pct-up' : 'pct-down',
    is_top:    parseInt(r.rank) <= 3,
  }));

  const dynamicTemplateData = {
    app_url:         appUrl,
    portfolio_url:   `${appUrl}/portfolio/weekly`,
    preferences_url: prefsUrl,
    unsubscribe_url: unsubUrl,
    user_email:      userEmail,
    send_day:        'Saturday',

    week_label:   weekLabel  || '',
    date_range:   dateRange  || '',
    trading_days: tradingDays || 5,

    week_pct_change:   formatPct(weekPctChange),
    week_pct_class:    parseFloat(weekPctChange) >= 0 ? 'up' : 'down',
    portfolio_value:   portfolioValue  || '—',
    dollar_change:     dollarChange    || '—',
    benchmark_return:  formatPct(benchmarkReturn),
    leaderboard_rank:  leaderboardRank || '—',
    rank_change_label: rankChangeLabel || 'no change',
    alltime_return:    formatPct(alltimeReturn),
    alltime_class:     parseFloat(alltimeReturn) >= 0 ? 'up' : 'down',
    start_date:        startDate || '',

    spark_bars:        sparkBars || [],
    best_performers:   bestPerformers  || [],
    worst_performers:  worstPerformers || [],
    news_themes:       newsThemes      || [],

    concentration_items:   concentrationItems   || [],
    concentration_warning: concentrationWarning || '',

    leaderboard_name: leaderboardName || 'Global',
    leaderboard_rows: leaderboardWithClasses,

    edu_category: eduCategory || 'Portfolio basics',
    edu_title:    eduTitle    || '',
    edu_body:     eduBody     || '',
  };

  await sgMail.send({
    to:   userEmail,
    from: FROM_DIGEST,
    templateId:          process.env.SENDGRID_TEMPLATE_WEEKLY,
    dynamicTemplateData,
  });

  console.log(`[emailService] Weekly digest sent → ${userEmail}`);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function buildHeadline(ticker, alertType, pctChange) {
  if (alertType === 'price_up')     return `${ticker} is up ${Math.abs(pctChange).toFixed(1)}% today`;
  if (alertType === 'price_down')   return `${ticker} dropped ${Math.abs(pctChange).toFixed(1)}% today`;
  if (alertType === 'volume_spike') return `${ticker} is seeing unusual trading volume`;
  return `Alert triggered for ${ticker}`;
}

module.exports = {
  sendRealtimeAlertEmail,
  sendDailyDigestEmail,
  sendWeeklyDigestEmail,
};