import type { User as FirebaseUser } from "firebase/auth";

export interface AccountProfile {
  id: string;
  email?: string;
  displayName: string;
  emailVerified: boolean;
}

export function firebaseAccountProfile(
  user: Pick<FirebaseUser, "uid" | "email" | "displayName" | "emailVerified">,
): AccountProfile {
  return {
    id: user.uid,
    email: user.email ?? undefined,
    displayName: user.displayName ?? "",
    emailVerified: user.emailVerified,
  };
}
