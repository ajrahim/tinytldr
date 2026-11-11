import path from "node:path";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import { firebaseAccountCreationTime, FirebaseOAuthProvider } from "./FirebaseOAuthProvider.js";
import { firebaseArtifactStorage } from "./HostedArtifacts.js";
import { startHostedMcpServer } from "./HostedServer.js";
import { SavedDesignReader } from "./SavedDesignReader.js";

async function main() {
  const configuration = z
    .object({
      projectId: z.string().min(1),
      databaseId: z.string().min(1),
      bucket: z.string().min(1),
      issuer: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.pathname === "/" &&
            !url.search &&
            !url.hash &&
            !url.username &&
            !url.password
          );
        }),
      port: z.coerce.number().int().min(1).max(65535),
      websiteDirectory: z.string().min(1),
      openAiAppsChallenge: z
        .string()
        .regex(/^[A-Za-z0-9_-]{16,128}$/)
        .optional(),
    })
    .parse({
      projectId: process.env.TINYTLDR_FIREBASE_PROJECT_ID,
      databaseId: process.env.TINYTLDR_MCP_DATABASE_ID,
      bucket: process.env.TINYTLDR_MCP_ARTIFACT_BUCKET,
      issuer: process.env.TINYTLDR_MCP_ISSUER_URL,
      port: process.env.PORT ?? "8080",
      websiteDirectory: process.env.TINYTLDR_MCP_WEBSITE_DIRECTORY,
      openAiAppsChallenge: process.env.TINYTLDR_OPENAI_APPS_CHALLENGE || undefined,
    });
  const app = initializeApp({
    projectId: configuration.projectId,
    credential: applicationDefault(),
  });
  const provider = new FirebaseOAuthProvider(
    getFirestore(app, configuration.databaseId),
    getAuth(app),
    new URL(configuration.issuer),
    firebaseAccountCreationTime(app),
  );
  const service = await startHostedMcpServer({
    provider,
    storage: firebaseArtifactStorage(getStorage(app), configuration.bucket),
    designs: new SavedDesignReader(getFirestore(app)),
    websiteDirectory: path.resolve(configuration.websiteDirectory),
    openAiAppsChallenge: configuration.openAiAppsChallenge,
    port: configuration.port,
    host: "0.0.0.0",
    reportError: (code, requestId) =>
      console.error(JSON.stringify({ severity: "ERROR", code, requestId })),
  });
  console.info(JSON.stringify({ service: "tinytldr-mcp", status: "listening" }));
  function shutdown() {
    void service.close().then(
      () => process.exit(0),
      () => {
        console.error(JSON.stringify({ severity: "ERROR", code: "shutdown_failed" }));
        process.exit(1);
      },
    );
  }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch(() => {
  console.error(JSON.stringify({ severity: "ERROR", code: "hosted_startup_failed" }));
  process.exitCode = 1;
});
