/**
 * Only `me` remains — Google Sign-In is handled client-side by Firebase
 * Auth, so there's no /register or /login here anymore (the backend never
 * sees a password; see services/userAuth.js for why).
 */
function me(req, res) {
  // req.user populated by userAuth.requireAuth middleware
  res.json({ user: req.user });
}

module.exports = { me };
