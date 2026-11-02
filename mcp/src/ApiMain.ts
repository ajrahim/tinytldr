import { createHash } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import { firebaseApiArtifactStorage } from "./ApiArtifacts.js";
import { ApiOriginSchema, startWebsiteApiServer } from "./ApiServer.js";

async function main() {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error("The production export API does not accept emulator tokens.");
  const configuration = z
    .object({
      projectId: z.string().min(1),
      databaseId: z.string().min(1),
      bucket: z.string().min(1),
      publicUrl: ApiOriginSchema,
      origins: z.array(ApiOriginSchema).min(1),
      outputDirectory: z.string().min(1),
      port: z.coerce.number().int().min(1).max(65535),
    })
    .parse({
      projectId: process.env.TINYTLDR_FIREBASE_PROJECT_ID,
      databaseId: process.env.TINYTLDR_API_DATABASE_ID ?? "(default)",
      bucket: process.env.TINYTLDR_API_ARTIFACT_BUCKET,
      publicUrl: process.env.TINYTLDR_API_PUBLIC_URL ?? "https://api.tinytldr.com",
      origins: (process.env.TINYTLDR_API_ALLOWED_ORIGINS ?? "https://www.tinytldr.com")
        .split(",")
        .map((origin) => origin.trim()),
      outputDirectory: process.env.TINYTLDR_API_OUTPUT_DIRECTORY ?? "./.tinytldr-api-output",
      port: process.env.PORT ?? "8080",
    });
  const app = initializeApp({
    projectId: configuration.projectId,
    credential: applicationDefault(),
  });
  const auth = getAuth(app);
  const database = getFirestore(app, configuration.databaseId);
  const service = await startWebsiteApiServer({
    ...configuration,
    allowedOrigins: configuration.origins,
    host: "0.0.0.0",
    verifyIdToken: (token) => auth.verifyIdToken(token, true),
    takeRender: async (uid) => {
      const minute = Math.floor(Date.now() / 60_000);
      const owner = createHash("sha256").update(uid).digest("hex");
      const ref = database.collection("websiteRenderLimits").doc(`${owner}-${minute}`);
      return database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const count = snapshot.exists
          ? z.object({ count: z.number().int().nonnegative() }).parse(snapshot.data()).count
          : 0;
        if (count >= 6) return false;
        transaction.set(ref, {
          count: count + 1,
          ttlAt: Timestamp.fromMillis((minute + 2) * 60_000),
        });
        return true;
      });
    },
    storage: firebaseApiArtifactStorage(
      getStorage(app),
      configuration.bucket,
      configuration.publicUrl,
    ),
    reportError: (code, requestId) =>
      console.error(JSON.stringify({ severity: "ERROR", code, requestId })),
  });
  console.info(JSON.stringify({ service: "tinytldr-website-api", status: "listening" }));
  const shutdown = () => {
    void service.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch(() => {
  console.error(JSON.stringify({ severity: "ERROR", code: "api_startup_failed" }));
  process.exitCode = 1;
});
