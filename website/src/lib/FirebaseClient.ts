import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { z } from "zod";
import {
  FirebaseDesignErrorSchema,
  FirebaseDesignRequestSchema,
  type FirebaseDesignRequest,
} from "@tinytldr/core";

export const FIREBASE_SETUP_MESSAGE =
  "Firebase sign-in and online saving are not configured. Set the Firebase environment variables, then restart the website. Local editing is still available.";

const ConfigurationSchema = z.object({
  apiKey: z.string().min(1),
  projectId: z.string().min(1),
  authDomain: z.string().regex(/^[a-zA-Z0-9.-]+$/),
  appId: z.string().min(1),
});

function configureFirebase() {
  const checked = ConfigurationSchema.safeParse({
    apiKey: import.meta.env.VITE_TINYTLDR_FIREBASE_API_KEY,
    projectId: import.meta.env.VITE_TINYTLDR_FIREBASE_PROJECT_ID,
    authDomain: import.meta.env.VITE_TINYTLDR_FIREBASE_AUTH_DOMAIN,
    appId: import.meta.env.VITE_TINYTLDR_FIREBASE_APP_ID,
  });
  if (!checked.success) return { auth: null, error: FIREBASE_SETUP_MESSAGE };
  try {
    const existing = getApps().find((app) => app.name === "tinytldr");
    if (existing && JSON.stringify(existing.options) !== JSON.stringify(checked.data))
      throw new Error(
        "An initialized Firebase app has different configuration. Reload the website.",
      );
    const auth = getAuth(existing ?? initializeApp(checked.data, "tinytldr"));
    const emulatorUrl = import.meta.env.VITE_TINYTLDR_FIREBASE_AUTH_EMULATOR_URL as
      string | undefined;
    if (emulatorUrl) {
      const endpoint = new URL(emulatorUrl);
      if (
        !import.meta.env.DEV ||
        endpoint.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(endpoint.hostname)
      )
        throw new Error("Firebase Auth emulation is only allowed on a local development server.");
      if (!auth.emulatorConfig)
        connectAuthEmulator(auth, endpoint.origin, { disableWarnings: true });
    }
    return { auth, error: null };
  } catch (error) {
    return {
      auth: null,
      error: `Invalid Firebase configuration: ${error instanceof Error ? error.message : String(error)} Local editing is still available.`,
    };
  }
}

const configuration = configureFirebase();
export const firebaseAuth = configuration.auth;
export const firebaseConfigurationError = configuration.error;

export function requireFirebaseAuth() {
  if (!firebaseAuth) throw new Error(firebaseConfigurationError ?? FIREBASE_SETUP_MESSAGE);
  return firebaseAuth;
}

interface FirebaseRequestAccount {
  requireSignIn?: boolean;
  expectedUserId?: string;
}

async function firebaseHeaders(
  signal?: AbortSignal,
  account: FirebaseRequestAccount = {},
): Promise<Record<string, string>> {
  const auth = requireFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (account.expectedUserId && user?.uid !== account.expectedUserId)
    throw new Error("Your account changed. Retry this action in the current account.");
  if (account.requireSignIn && !user) throw new Error("Sign in before exporting rendered media.");
  const token = await user?.getIdToken();
  signal?.throwIfAborted();
  if (auth.currentUser?.uid !== user?.uid)
    throw new Error("Your account changed. Retry this action in the current account.");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchFirebaseService(
  endpoint: string,
  request: object,
  service: "design" | "AI" | "export" | "media",
  signal?: AbortSignal,
  account: FirebaseRequestAccount = {},
) {
  const url = new URL(endpoint, window.location.origin);
  if (
    url.protocol !== "https:" &&
    !(
      import.meta.env.DEV &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error(
      `The Firebase ${service} service must use HTTPS, except for local development.`,
    );
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await firebaseHeaders(signal, account)),
    },
    body: JSON.stringify(request),
    signal,
    redirect: "error",
  });
}

export async function fetchFirebaseArtifact(
  endpoint: string,
  apiOrigin: string,
  signal: AbortSignal,
  expectedUserId?: string,
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.origin !== apiOrigin ||
    !url.pathname.startsWith("/v1/assets/") ||
    url.username ||
    url.password
  )
    throw new Error("The export service returned an invalid private artifact URL.");
  return fetch(url, {
    headers: await firebaseHeaders(signal, { requireSignIn: true, expectedUserId }),
    signal,
    redirect: "error",
  });
}

export async function callFirebaseDesign<Output, Input>(
  request: FirebaseDesignRequest,
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
  expectedUserId?: string,
): Promise<Output> {
  requireFirebaseAuth();
  const endpoint = import.meta.env.VITE_TINYTLDR_FIREBASE_DESIGNS_URL as string | undefined;
  if (!endpoint)
    throw new Error(
      "Firebase design saving is not configured. Set VITE_TINYTLDR_FIREBASE_DESIGNS_URL to the deployed design service.",
    );
  const response = await fetchFirebaseService(
    endpoint,
    FirebaseDesignRequestSchema.parse(request),
    "design",
    undefined,
    { expectedUserId },
  );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `The Firebase design service returned an invalid response (HTTP ${response.status}). Check its deployment.`,
    );
  }
  if (!response.ok) {
    const checked = FirebaseDesignErrorSchema.safeParse(payload);
    throw new Error(
      checked.success
        ? checked.data.error
        : `Firebase design operation failed (HTTP ${response.status}).`,
    );
  }
  const envelope = z.object({ data: z.unknown() }).strict().safeParse(payload);
  if (!envelope.success || !Object.hasOwn(envelope.data, "data"))
    throw new Error("The Firebase design service returned an invalid response envelope.");
  const checked = schema.safeParse(envelope.data.data);
  if (!checked.success)
    throw new Error(
      "The Firebase design service returned invalid data. Your browser draft was not discarded.",
    );
  return checked.data;
}
