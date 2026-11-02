import { applyActionCode, confirmPasswordReset, signInWithCustomToken } from "firebase/auth";
import { requireFirebaseAuth } from "../src/lib/FirebaseClient.js";

export async function signInTestAccount(token: string) {
  await signInWithCustomToken(requireFirebaseAuth(), token);
}

export async function verifyTestEmail(code: string) {
  await applyActionCode(requireFirebaseAuth(), code);
}

export async function resetTestPassword(code: string, password: string) {
  await confirmPasswordReset(requireFirebaseAuth(), code, password);
}
