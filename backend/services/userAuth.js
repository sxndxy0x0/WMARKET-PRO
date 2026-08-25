const { getAuth } = require('firebase-admin/auth');
require('../database/firestore'); // side effect: ensures the Firebase app is initialized before getAuth() below runs

/**
 * Auth is Google Sign-In only, via Firebase Authentication (client SDK signs
 * the user in with Google; the frontend sends the resulting Firebase ID
 * token as `Authorization: Bearer <idToken>`). This backend never handles
 * a password — Firebase Auth verifies the Google identity and issues the
 * token; `verifyIdToken` below just checks that token's signature/expiry.
 *
 * No `users` Firestore collection needed: Firebase Auth already IS the
 * user store (uid, email, display name, photo). Rebuilding a parallel copy
 * in Firestore would just be another thing to keep in sync for no benefit
 * — watchlist/alerts already key off `userId` (a plain string), and a
 * Firebase uid is just as good a string as a Firestore-generated one was.
 * Bonus: this means requireAuth no longer does a Firestore/Auth read at
 * all beyond verifying the token's signature, which is cheaper than the
 * cached "does this user still exist" Firestore lookup this replaces.
 */

function toPublicUser(decodedToken) {
  return {
    id: decodedToken.uid,
    email: decodedToken.email || null,
    name: decodedToken.name || null,
    picture: decodedToken.picture || null,
  };
}

/** Express middleware: requires a valid Firebase ID token (Google sign-in). */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = toPublicUser(decoded);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth, toPublicUser };
