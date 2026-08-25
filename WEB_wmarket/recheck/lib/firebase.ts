import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

// These NEXT_PUBLIC_* values are safe to expose in the browser bundle —
// they identify which Firebase project to talk to, they are not secrets
// (the same way a database hostname isn't a secret; access is controlled
// by Firebase's own rules/token verification, not by hiding this config).
// Get them from: Firebase Console -> Project Settings -> General ->
// "Your apps" -> Web app -> SDK setup and configuration.
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let cachedAuth: Auth | null = null;

/**
 * Lazily creates (once) and returns the Firebase Auth instance.
 *
 * Deliberately NOT a top-level `export const auth = getAuth(...)`: the
 * components that use this (lib/auth-context.tsx) are 'use client', but
 * Next.js's App Router still executes client components' module code once
 * on the SERVER to produce the initial prerendered HTML. Firebase Auth's
 * client SDK assumes a real browser (window, indexedDB for session
 * persistence) — calling getAuth() eagerly at module scope crashes that
 * server-side prerender pass entirely (confirmed: `next build` fails with
 * `auth/invalid-api-key` on /_not-found even before any page-specific
 * code runs, simply from evaluating this module). Deferring the actual
 * getAuth() call to only ever happen inside effects/event handlers (which
 * never run during SSR) avoids that.
 */
export function getFirebaseAuth(): Auth {
  if (typeof window === 'undefined') {
    throw new Error('getFirebaseAuth() must only be called in the browser');
  }
  if (!cachedAuth) {
    const app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
    cachedAuth = getAuth(app);
  }
  return cachedAuth;
}

// Safe to construct at module scope (unlike getAuth()) — this is just a
// plain config object, it doesn't touch window/indexedDB or need an
// initialized app.
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
