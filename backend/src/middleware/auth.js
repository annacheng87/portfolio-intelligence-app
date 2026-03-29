const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  // Get the token from the request header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Not logged in. Please provide a token.' });
  }

  try {
    // Verify the token is valid and hasn't been tampered with
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId; // Attach the user's ID to the request
    next(); // Allow the request to continue
  } catch (err) {
    return res.status(403).json({ error: 'Token is invalid or expired. Please log in again.' });
  }
};