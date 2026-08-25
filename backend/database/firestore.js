// firebase-admin v12+ dropped the old namespaced API (admin.apps,
// admin.firestore(), admin.credential.cert()) in favor of a modular one —
// confirmed against the actually-installed v14 package (the old style
// silently gives `undefined` for admin.apps instead of erroring clearly,
// which is an easy trap). Use the modular imports instead:
const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * Auth options (pick ONE, via env vars):
 *
 * 1. Local development — Application Default Credentials via gcloud CLI:
 *      gcloud auth application-default login
 *    No env vars needed.
 *
 * 2. Service account key file (most common for servers/deploys):
 *      GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
 *    Download this JSON from Firebase Console -> Project Settings ->
 *    Service Accounts -> Generate new private key. NEVER commit this file
 *    or check it into git (see .gitignore).
 *
 * 3. Service account key as a single env var (common on hosts where you
 *    can't easily mount a file, e.g. Render/Railway/Vercel):
 *      FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
 *    Paste the ENTIRE downloaded JSON file content as one line.
 */
if (getApps().length === 0) {
  const inlineCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (inlineCredentials) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(inlineCredentials);
    } catch (e) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON. ' +
          'Paste the full contents of the downloaded service account key file as one line.'
      );
    }
    initializeApp({ credential: cert(serviceAccount) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
  } else {
    throw new Error(
      'No Firebase credentials found. Set either FIREBASE_SERVICE_ACCOUNT_JSON ' +
        '(paste the whole service account key JSON as one line) or ' +
        'GOOGLE_APPLICATION_CREDENTIALS (path to the key file) in your .env. ' +
        'See database/firestore.js for details.'
    );
  }
}

const db = getFirestore();

module.exports = { db, FieldValue };
