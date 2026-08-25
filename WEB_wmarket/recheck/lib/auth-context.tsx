'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { getFirebaseAuth, googleProvider } from './firebase';
import * as api from './api';
import { User } from './api';

type AuthState = {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestId = useRef(0);

  useEffect(() => {
    // getFirebaseAuth() (and everything below) only ever runs here, inside
    // an effect — effects never run during Next.js's server-side
    // prerendering, only after the component mounts in the browser. See
    // lib/firebase.ts for why that distinction matters.
    const auth = getFirebaseAuth();

    // Firebase restores the signed-in session (from IndexedDB) and fires
    // this on load, and again on every sign-in/sign-out — this replaces
    // the old "read a token out of localStorage on mount" logic entirely.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      const requestId = ++authRequestId.current;
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        // Round-trips through our own backend (rather than trusting the
        // Firebase user object directly) so `user` always reflects what
        // the backend's token verification actually accepted.
        const { user: profile } = await api.fetchMe();
        if (requestId === authRequestId.current) setUser(profile);
      } catch {
        if (requestId === authRequestId.current) setUser(null);
      } finally {
        if (requestId === authRequestId.current) setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(getFirebaseAuth(), googleProvider);
    // onAuthStateChanged above picks up the resulting session and sets
    // `user` — nothing else to do here.
  }, []);

  const logout = useCallback(async () => {
    // Invalidate any in-flight fetchMe() started for the previous auth state
    // before changing local state. Otherwise a slow profile response could
    // arrive after signOut() and restore the old user for one render.
    authRequestId.current += 1;
    await signOut(getFirebaseAuth());
    setUser(null);
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
