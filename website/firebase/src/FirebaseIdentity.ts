import type { Auth } from "firebase-admin/auth";

export function createFirebaseUserVerifier(auth: Auth) {
  return async (token: string) => {
    try {
      return (await auth.verifyIdToken(token, true)).uid;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        [
          "auth/argument-error",
          "auth/invalid-id-token",
          "auth/id-token-expired",
          "auth/id-token-revoked",
          "auth/user-disabled",
          "auth/user-not-found",
        ].includes(String(error.code))
      )
        return null;
      throw error;
    }
  };
}
