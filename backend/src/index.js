require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });

const express = require('express');
const cors = require('cors');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const passport = require('passport');
require('./routes/auth');
app.use(passport.initialize());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/broker',    require('./routes/broker'));
app.use('/api/portfolio', require('./routes/sectorExposure'));

app.use('/api/trading',   require('./routes/trading'));
app.use('/api/friends',   require('./routes/friends'));
app.use('/api/stats',     require('./routes/stats'));      // ← NEW

try {
  app.use('/api/polymarket', require('./routes/polymarket'));
  console.log('[OK] polymarket routes mounted');
} catch (err) {
  console.error('[FAIL] polymarket routes failed to mount:', err);
}


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  startScheduler();
});