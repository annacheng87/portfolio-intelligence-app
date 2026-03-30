const cron = require('node-cron');
const { evaluateWatchlists } = require('./alertEvaluator');

function startScheduler() {
  console.log('Starting alert scheduler...');

  // Run immediately on startup
  evaluateWatchlists().catch(err => {
    console.error('Initial evaluation error:', err);
  });

  // Run every 15 minutes during market hours Mon-Fri
  cron.schedule('*/15 9-16 * * 1-5', async () => {
    console.log('Scheduled check at', new Date().toISOString());
    try {
      await evaluateWatchlists();
    } catch (err) {
      console.error('Scheduled evaluator error:', err);
    }
  }, {
    timezone: 'America/New_York'
  });

  // Keep the process alive even outside market hours
  setInterval(() => {}, 1 << 30);

  console.log('Scheduler running — checks every 15 min during market hours.');
}

module.exports = { startScheduler };