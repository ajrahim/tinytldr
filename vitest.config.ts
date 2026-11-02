import { defineConfig } from "vitest/config";

if (
  process.env.TINYTLDR_REQUIRE_FIREBASE_EMULATORS === "1" &&
  (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
) {
  throw new Error("The verification gate requires real Firebase Auth and Firestore emulators.");
}

export default defineConfig({
  test: {
    include: [
      "packages/**/test/**/*.test.ts",
      "mcp/test/**/*.test.ts",
      "website/**/test/**/*.test.ts",
      "scripts/test/**/*.test.mjs",
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
