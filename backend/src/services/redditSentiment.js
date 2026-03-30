const axios = require('axios');

const SUBREDDITS = ['stocks', 'investing', 'wallstreetbets'];

const POSITIVE_WORDS = [
  'bull', 'bullish', 'buy', 'buying', 'long', 'calls', 'moon', 'pump',
  'beat', 'beats', 'surge', 'surges', 'gain', 'gains', 'profit', 'growth',
  'strong', 'record', 'upgrade', 'outperform', 'higher', 'rocket', 'squeeze',
];

const NEGATIVE_WORDS = [
  'bear', 'bearish', 'sell', 'selling', 'short', 'puts', 'dump', 'crash',
  'miss', 'misses', 'drops', 'falls', 'loss', 'losses', 'weak', 'cut',
  'downgrade', 'underperform', 'lower', 'warning', 'decline', 'disappoints',
  'scam', 'fraud', 'lawsuit', 'investigation', 'concern', 'risk',
];

// Fetch Reddit posts mentioning a ticker
async function getRedditPosts(ticker) {
  const posts = [];

  for (const subreddit of SUBREDDITS) {
    try {
      const res = await axios.get(
        `https://www.reddit.com/r/${subreddit}/search.json`,
        {
          params: {
            q: ticker,
            sort: 'relevance',
            t: 'week',
            limit: 10,
          },
          headers: {
            'User-Agent': 'portfolio-intelligence/1.0',
          },
          timeout: 5000,
        }
      );

      const items = res.data?.data?.children || [];

      for (const item of items) {
        const post = item.data;

        // Quality filters — remove low quality and biased posts
        if (post.score < 10) continue;          // min 10 upvotes
        if (post.author === '[deleted]') continue;
        if (post.selftext === '[removed]') continue;
        if (post.over_18) continue;              // no NSFW

        // Make sure the ticker is actually mentioned
        const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
        if (!text.includes(ticker.toLowerCase()) &&
            !text.includes('$' + ticker.toLowerCase())) continue;

        posts.push({
          title: post.title,
          score: post.score,
          url: `https://reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          numComments: post.num_comments,
          author: post.author,
        });
      }

      // Delay between subreddit requests
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err) {
      console.error(`Reddit fetch failed for r/${subreddit}:`, err.message);
    }
  }

  // Sort by score — highest quality posts first
  return posts.sort((a, b) => b.score - a.score).slice(0, 5);
}

function scoreRedditSentiment(posts) {
  if (posts.length === 0) {
    return { label: 'neutral', score: 0, postCount: 0, topPost: null };
  }

  let totalScore = 0;

  for (const post of posts) {
    const text = post.title.toLowerCase();
    const words = text.split(/\s+/);
    let postScore = 0;

    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (POSITIVE_WORDS.includes(clean)) postScore += 1;
      if (NEGATIVE_WORDS.includes(clean)) postScore -= 1;
    }

    // Weight by upvotes — higher upvoted posts count more
    totalScore += postScore * Math.log(post.score + 1);
  }

  const normalized = totalScore / posts.length;

  let label;
  if (normalized > 0.5) label = 'positive';
  else if (normalized < -0.5) label = 'negative';
  else label = 'neutral';

  return {
    label,
    score: normalized,
    postCount: posts.length,
    topPost: posts[0] || null,
  };
}

function redditSentimentToEnglish(ticker, sentiment) {
  if (sentiment.postCount === 0) {
    return null; // Don't add Reddit section if no posts found
  }

  const source = `Reddit (${sentiment.postCount} posts from r/stocks, r/investing, r/wallstreetbets)`;

  if (sentiment.label === 'positive') {
    return `Reddit sentiment is bullish — ${source} show positive discussion around ${ticker}.`;
  }
  if (sentiment.label === 'negative') {
    return `Reddit sentiment is bearish — ${source} show negative discussion around ${ticker}.`;
  }
  return `Reddit sentiment is mixed — ${source} show no clear directional bias for ${ticker}.`;
}

async function getTickerRedditSentiment(ticker) {
  const posts = await getRedditPosts(ticker);
  const sentiment = scoreRedditSentiment(posts);
  return { ticker, ...sentiment };
}

module.exports = { getTickerRedditSentiment, redditSentimentToEnglish };