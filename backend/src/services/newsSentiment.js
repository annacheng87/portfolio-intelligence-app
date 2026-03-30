const axios = require('axios');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

async function getNewsForTicker(ticker) {
  try {
    const today = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);

    const from = weekAgo.toISOString().split('T')[0];
    const to = today.toISOString().split('T')[0];

    const res = await axios.get(
      `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    return res.data.slice(0, 5);
  } catch (err) {
    console.error(`Failed to fetch news for ${ticker}:`, err.message);
    return [];
  }
}

function scoreSentiment(articles) {
  const positiveWords = [
    'beat', 'beats', 'surge', 'surges', 'jumps', 'rises', 'gain', 'gains',
    'profit', 'growth', 'strong', 'record', 'upgrade', 'buy', 'bullish',
    'outperform', 'raised', 'higher', 'positive', 'success', 'launches',
  ];

  const negativeWords = [
    'miss', 'misses', 'drops', 'falls', 'tumbles', 'plunges', 'loss', 'losses',
    'weak', 'cut', 'cuts', 'downgrade', 'sell', 'bearish', 'underperform',
    'lowered', 'lower', 'negative', 'recall', 'lawsuit', 'investigation',
    'concern', 'risk', 'warning', 'decline', 'disappoints',
  ];

  let score = 0;

  for (const article of articles) {
    const text = (article.headline + ' ' + (article.summary || '')).toLowerCase();
    const words = text.split(/\s+/);

    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (positiveWords.includes(clean)) score += 1;
      if (negativeWords.includes(clean)) score -= 1;
    }
  }

  if (articles.length === 0) return { label: 'neutral', score: 0, topArticle: null };

  const normalizedScore = score / articles.length;

  let label;
  if (normalizedScore > 0.3) label = 'positive';
  else if (normalizedScore < -0.3) label = 'negative';
  else label = 'neutral';

  return {
    label,
    score: normalizedScore,
    topArticle: articles[0] ? {
      headline: articles[0].headline,
      url: articles[0].url,
      source: articles[0].source,
    } : null,
    articleCount: articles.length,
  };
}

async function getTickerSentiment(ticker) {
  const articles = await getNewsForTicker(ticker);
  const sentiment = scoreSentiment(articles);
  return { ticker, ...sentiment, articles };
}

function sentimentToEnglish(sentiment) {
  if (sentiment.label === 'positive') {
    return `News sentiment is positive — recent headlines are broadly favorable for ${sentiment.ticker}.`;
  }
  if (sentiment.label === 'negative') {
    return `News sentiment is negative — recent headlines show concern around ${sentiment.ticker}.`;
  }
  return `News sentiment is neutral — no strong directional signal from recent headlines.`;
}

module.exports = { getTickerSentiment, sentimentToEnglish };