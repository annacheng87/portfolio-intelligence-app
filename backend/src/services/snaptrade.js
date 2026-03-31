const { Snaptrade } = require('snaptrade-typescript-sdk');

const client = new Snaptrade({
  clientId: process.env.SNAPTRADE_CLIENT_ID,
  consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
});

// Register a new SnapTrade user (called once when user connects broker)
// Returns { userId, userSecret } on success
// Returns null if user already exists in SnapTrade (code 1012)
async function registerSnaptradeUser(userId) {
  try {
    const response = await client.authentication.registerSnapTradeUser({
      userId: userId,
    });
    return response.data;
  } catch (err) {
    const status = err?.status;
    const code   = err?.responseBody?.code;

    console.error('Snaptrade register error — status:', status, '| code:', code);

    // code 1012 = user already exists in SnapTrade
    if (status === 400 && code === '1012') {
      console.log('Snaptrade user already exists (1012) — will use existing secret from DB');
      return null;
    }
    if (status === 409) {
      console.log('Snaptrade user already exists (409) — will use existing secret from DB');
      return null;
    }
    throw err;
  }
}

// Delete a SnapTrade user so they can be re-registered fresh
async function deleteSnaptradeUser(userId, userSecret) {
  try {
    await client.authentication.deleteSnapTradeUser({
      userId,
      userSecret,
    });
    console.log('Snaptrade user deleted:', userId);
  } catch (err) {
    console.error('Snaptrade delete user error:', err?.status, err?.responseBody?.code);
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
    console.error('Snaptrade connection link error — status:', err?.status, '| code:', err?.responseBody?.code);
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
            accountId:    account.id,
            accountName:  account.name,
            ticker: position.symbol?.symbol?.symbol || position.symbol?.symbol?.raw_symbol || position.symbol?.ticker || position.symbol?.raw_symbol,
            quantity:     position.units,
            avgCostBasis: position.average_purchase_price || 0,
            currentPrice: position.price,
            marketValue:  position.market_value,
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
  deleteSnaptradeUser,
  generateConnectionLink,
  getUserAccounts,
  getAllHoldings,
};