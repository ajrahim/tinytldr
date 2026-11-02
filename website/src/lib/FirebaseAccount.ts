import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  validatePassword,
  type User,
} from "firebase/auth";
import { requireFirebaseAuth } from "./FirebaseClient.js";

export async function signInFirebaseWithPassword(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(requireFirebaseAuth(), email.trim(), password);
}

export async function createFirebasePasswordAccount(
  email: string,
  password: string,
): Promise<User> {
  const auth = requireFirebaseAuth();
  const status = await validatePassword(auth, password);
  if (!status.isValid) {
    const requirements: string[] = [];
    if (status.meetsMinPasswordLength === false)
      requirements.push(
        `at least ${status.passwordPolicy.customStrengthOptions.minPasswordLength} characters`,
      );
    if (status.meetsMaxPasswordLength === false)
      requirements.push(
        `at most ${status.passwordPolicy.customStrengthOptions.maxPasswordLength} characters`,
      );
    if (status.containsLowercaseLetter === false) requirements.push("a lowercase letter");
    if (status.containsUppercaseLetter === false) requirements.push("an uppercase letter");
    if (status.containsNumericCharacter === false) requirements.push("a number");
    if (status.containsNonAlphanumericCharacter === false) requirements.push("a symbol");
    throw new Error(
      requirements.length
        ? `Use ${requirements.join(", ")} in your password.`
        : "Your password does not meet the required strength.",
    );
  }
  return (await createUserWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function sendFirebaseVerification(user: User, redirect: string): Promise<void> {
  await sendEmailVerification(user, { url: redirect });
}

export async function resetFirebasePassword(email: string, redirect: string): Promise<void> {
  await sendPasswordResetEmail(requireFirebaseAuth(), email.trim(), { url: redirect });
}

export async function signInFirebaseWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(requireFirebaseAuth(), provider);
}

export function firebaseSignInError(error: unknown, action: "signin" | "reset" = "signin"): string {
  if (error instanceof Error && "code" in error) {
    if (action === "reset" && error.code === "auth/user-not-found")
      return "The account service could not send a reset email. Check the email address or try again.";
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Email or password is incorrect.";
      case "auth/email-already-in-use":
        return "An account already uses this email. Sign in, or reset your password.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/weak-password":
        return "Your password does not meet the required strength.";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "Google sign-in was cancelled. You can try again.";
      case "auth/popup-blocked":
        return "Your browser blocked Google sign-in. Allow popups for this site, then try again.";
      case "auth/account-exists-with-different-credential":
        return "This email already has an account with another sign-in method. Use your existing method to sign in.";
      case "auth/operation-not-allowed":
        return "This sign-in method is disabled in Firebase Authentication. Enable it in the project settings.";
      case "auth/unauthorized-domain":
        return "This website host is not authorized for Firebase sign-in. Add it to the project's authorized domains.";
      case "auth/network-request-failed":
        return "Could not reach the account service. Check your connection and try again.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait before trying again.";
      case "auth/user-disabled":
        return "This account has been disabled. Contact the site owner.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}
