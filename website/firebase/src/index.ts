import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { Agent, fetch as undiciFetch } from "undici";
import { region } from "firebase-functions/v1";
import { createDesignGateway } from "./DesignGateway.js";
import { DesignService } from "./DesignService.js";
import { AiConnectionService } from "./AiConnectionService.js";
import { createFirebaseHttpHandler } from "./FirebaseHttp.js";
import { createFirebaseUserVerifier } from "./FirebaseIdentity.js";
import { createAiGateway } from "../../server/AiGateway.ts";
import { MediaService } from "./MediaService.js";
import { createMediaGateway } from "./MediaGateway.js";

initializeApp();
const database = getFirestore();
const allowedOrigins = (process.env.TINYTLDR_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const verifyUser = createFirebaseUserVerifier(getAuth());
const gateway = createDesignGateway({
  service: new DesignService(database),
  allowedOrigins,
  verifyUser,
  reportError: (error) =>
    logger.error("Firebase design operation failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error && "code" in error ? String(error.code) : "unknown",
    }),
});

export const designs = onRequest(
  { region: "us-central1", minInstances: 0, maxInstances: 2, memory: "256MiB", timeoutSeconds: 30 },
  createFirebaseHttpHandler(gateway),
);

let mediaService: MediaService | undefined;
const getMediaService = () =>
  (mediaService ??= new MediaService(
    database,
    getStorage(),
    process.env.TINYTLDR_FIREBASE_STORAGE_BUCKET ?? "",
  ));
export const media = onRequest(
  {
    region: "us-central1",
    minInstances: 0,
    maxInstances: 2,
    memory: "1GiB",
    concurrency: 1,
    timeoutSeconds: 120,
  },
  createFirebaseHttpHandler(
    createMediaGateway({
      service: getMediaService,
      allowedOrigins,
      verifyUser,
      reportError: (error) =>
        logger.error("Firebase media operation failed.", {
          name: error instanceof Error ? error.name : "UnknownError",
          code: error instanceof Error && "code" in error ? String(error.code) : "unknown",
        }),
    }),
  ),
);
export const deleteMediaAccount = region("us-central1")
  .runWith({ minInstances: 0, maxInstances: 2, memory: "256MB", failurePolicy: true })
  .auth.user()
  .onDelete((user) => getMediaService().deleteAccount(user.uid));

const encryptionKey = defineSecret("TINYTLDR_AI_ENCRYPTION_KEY");
// Node's default 300s header/body timeouts would cut off long non-streaming provider calls;
// the gateway's own abort signal bounds them instead.
const providerAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const providerFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: providerAgent,
  })) as unknown as typeof fetch;
const aiService = new AiConnectionService(database, () => encryptionKey.value());
export const ai = onRequest(
  {
    region: "us-central1",
    minInstances: 0,
    maxInstances: 2,
    memory: "512MiB",
    concurrency: 4,
    timeoutSeconds: 480,
    secrets: [encryptionKey],
  },
  createFirebaseHttpHandler(
    createAiGateway({
      allowedOrigins,
      verifyUser,
      store: aiService,
      customBaseUrls: (process.env.TINYTLDR_AI_CUSTOM_BASE_URLS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      fetch: providerFetch,
      reportError: (code) => logger.error("Firebase AI request failed.", { code }),
    }),
  ),
);

export const deleteAiAccount = region("us-central1")
  .runWith({ minInstances: 0, maxInstances: 2, memory: "256MB", failurePolicy: true })
  .auth.user()
  .onDelete((user) => aiService.deleteAccount(user.uid));
