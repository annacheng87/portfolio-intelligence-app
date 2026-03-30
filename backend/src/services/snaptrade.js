const { Snaptrade } = require('snaptrade-typescript-sdk');

const client = new Snaptrade({
  clientId: process.env.SNAPTRADE_CLIENT_ID,
  consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
});

// Register a new SnapTrade user (called once when user connects broker)
async function registerSnaptradeUser(userId) {
  try {
    const response = await client.authentication.registerSnapTradeUser({
      userId: userId,
    });
    return response.data;
  } catch (err) {
    // User might already be registered — that's fine
    if (err?.response?.status === 409) {
      console.log('Snaptrade user already registered:', userId);
      return { userId };
    }
    console.error('Snaptrade register error:', err.message);
    throw err;
  }
}

// Generate a connection link for the user to connect their broker
async function generateConnectionLink(userId, userSecret) {
  try {
    const response = await client.authentication.loginSnapTradeUser({
      userId,
      userSecret,
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade connection link error:', err.message);
    throw err;
  }
}

// Get all brokerage accounts for a user
async function getUserAccounts(userId, userSecret) {
  try {
    const response = await client.accountInformation.listUserAccounts({
      userId,
      userSecret,
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade get accounts error:', err.message);
    throw err;
  }
}

// Get holdings for a specific account
async function getAccountHoldings(userId, userSecret, accountId) {
  try {
    const response = await client.accountInformation.getUserHoldings({
      userId,
      userSecret,
      accountId,
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade get holdings error:', err.message);
    throw err;
  }
}

// Get holdings across ALL accounts for a user
async function getAllHoldings(userId, userSecret) {
  try {
    const accounts = await getUserAccounts(userId, userSecret);
    if (!accounts || accounts.length === 0) return [];

    const allHoldings = [];
    for (const account of accounts) {
      const holdings = await getAccountHoldings(userId, userSecret, account.id);
      if (holdings?.positions) {
        for (const position of holdings.positions) {
          allHoldings.push({
            accountId: account.id,
            accountName: account.name,
            ticker: position.symbol?.symbol || position.symbol?.ticker,
            quantity: position.units,
            avgCostBasis: position.average_purchase_price || 0,
            currentPrice: position.price,
            marketValue: position.market_value,
          });
        }
      }
    }
    return allHoldings;
  } catch (err) {
    console.error('Snaptrade get all holdings error:', err.message);
    return [];
  }
}

module.exports = {
  registerSnaptradeUser,
  generateConnectionLink,
  getUserAccounts,
  getAllHoldings,
};