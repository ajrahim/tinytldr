import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, updateProfile } from "firebase/auth";
import { AccountProfileInputSchema } from "@tinytldr/core";
import { resolveAuthReturnPath } from "../state/RouterState.js";
import { firebaseAccountProfile, type AccountProfile } from "../lib/AccountProfile.js";
import {
  firebaseAuth,
  firebaseConfigurationError,
  requireFirebaseAuth,
} from "../lib/FirebaseClient.js";
import {
  createFirebasePasswordAccount,
  firebaseSignInError,
  resetFirebasePassword,
  sendFirebaseVerification,
  signInFirebaseWithGoogle,
  signInFirebaseWithPassword,
} from "../lib/FirebaseAccount.js";

interface AccountSession {
  user: AccountProfile;
}

export function useAccount() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [ready, setReady] = useState(!firebaseAuth);
  const [error, setError] = useState<string | null>(firebaseConfigurationError);
  const activeUserId = useRef<string | null>(null);
  const accountVersion = useRef(0);
  const publishSession = useCallback((next: AccountSession | null) => {
    const nextId = next?.user.id ?? null;
    if (nextId !== activeUserId.current) {
      activeUserId.current = nextId;
      accountVersion.current += 1;
    }
    setSession(next);
  }, []);

  useEffect(() => {
    if (!firebaseAuth) return;
    let active = true;
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => {
        if (!active) return;
        publishSession(user ? { user: firebaseAccountProfile(user) } : null);
        setReady(true);
      },
      (authError) => {
        if (active) {
          setError(authError.message);
          setReady(true);
        }
      },
    );
    return () => {
      active = false;
      activeUserId.current = null;
      accountVersion.current += 1;
      unsubscribe();
    };
  }, [publishSession]);

  const updateDisplayName = useCallback(
    async (displayName: string) => {
      const checked = AccountProfileInputSchema.safeParse({ displayName });
      if (!checked.success) throw new Error(checked.error.issues[0]!.message);
      const userId = activeUserId.current;
      const version = accountVersion.current;
      if (!userId) throw new Error("Sign in before updating your profile.");
      const user = requireFirebaseAuth().currentUser;
      if (!user || user.uid !== userId) throw new Error("Your account changed. Sign in again.");
      await updateProfile(user, { displayName: checked.data.displayName });
      const updated = firebaseAccountProfile(user);
      if (
        activeUserId.current !== userId ||
        accountVersion.current !== version ||
        updated.id !== userId
      )
        throw new Error("Your account changed before the profile update finished. Sign in again.");
      publishSession({ user: updated });
    },
    [publishSession],
  );

  const signOut = useCallback(async () => {
    await firebaseSignOut(requireFirebaseAuth());
    setError(null);
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    await signInFirebaseWithPassword(email, password);
    setError(null);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInFirebaseWithGoogle();
    setError(null);
  }, []);

  const createPasswordAccount = useCallback(
    async (email: string, password: string, next: string) => {
      const target = resolveAuthReturnPath(next, window.location.origin);
      const redirect = new URL("/auth/callback", window.location.origin);
      redirect.searchParams.set("next", target);
      const user = await createFirebasePasswordAccount(email, password);
      setError(null);
      try {
        await sendFirebaseVerification(user, redirect.toString());
      } catch (err: unknown) {
        const message = `Your account was created, but the verification email could not be sent: ${firebaseSignInError(err)}`;
        if (requireFirebaseAuth().currentUser?.uid === user.uid) setError(message);
        throw new Error(message);
      }
    },
    [],
  );

  const resetPassword = useCallback(async (email: string, next: string) => {
    const redirect = new URL(
      resolveAuthReturnPath(next, window.location.origin),
      window.location.origin,
    );
    await resetFirebasePassword(email, redirect.toString());
    setError(null);
  }, []);

  return {
    session,
    user: session?.user ?? null,
    ready,
    error,
    updateDisplayName,
    signOut,
    signInWithPassword,
    signInWithGoogle,
    createPasswordAccount,
    resetPassword,
  };
}

export type Account = ReturnType<typeof useAccount>;
