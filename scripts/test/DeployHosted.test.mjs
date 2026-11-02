import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  apiDeploymentCommands,
  createDeploymentConfiguration,
  createFirebaseDeploymentPlan,
  websiteEnvironment,
} from "../DeployHosted.mjs";

const configuration = JSON.parse(readFileSync(new URL("../../firebase.json", import.meta.url)));
const environment = {
  TINYTLDR_FIREBASE_PROJECT_ID: "example-project",
  TINYTLDR_FIREBASE_HOSTING_SITE: "example-site",
  TINYTLDR_API_SERVICE_ID: "website-api",
  TINYTLDR_API_REGION: "us-central1",
  TINYTLDR_API_IMAGE: "us-central1-docker.pkg.dev/example-project/render/api:latest",
  TINYTLDR_API_ARTIFACT_BUCKET: "example-private-renders",
  TINYTLDR_API_SERVICE_ACCOUNT: "renderer@example-project.iam.gserviceaccount.com",
  FIREBASE_API_KEY: "public-browser-key",
  FIREBASE_APP_ID: "public-app-id",
  FIREBASE_AUTH_DOMAIN: "example-project.firebaseapp.com",
};

describe("Firebase Hosting deployment configuration", () => {
  it.each(["functions:tinytldr", "firestore", "firestore,functions:tinytldr"])(
    "keeps %s deployment independent of Hosting, API and browser configuration",
    (targets) => {
      const minimal = { TINYTLDR_FIREBASE_PROJECT_ID: "example-project" };
      const plan = createFirebaseDeploymentPlan(configuration, minimal, targets);
      expect(plan.configuration).toBeUndefined();
      expect(plan.environment).toBe(minimal);
      expect(plan.environment).not.toHaveProperty("VITE_TINYTLDR_FIREBASE_API_KEY");
    },
  );

  it("requires Hosting configuration for default and explicitly selected Hosting targets", () => {
    const minimal = { TINYTLDR_FIREBASE_PROJECT_ID: "example-project" };
    expect(() => createFirebaseDeploymentPlan(configuration, minimal)).toThrow(
      "TINYTLDR_FIREBASE_HOSTING_SITE",
    );
    expect(() =>
      createFirebaseDeploymentPlan(configuration, minimal, "hosting:example-site"),
    ).toThrow("TINYTLDR_FIREBASE_HOSTING_SITE");
    const plan = createFirebaseDeploymentPlan(configuration, environment);
    expect(plan.configuration.hosting.site).toBe("example-site");
    expect(plan.environment.VITE_TINYTLDR_FIREBASE_API_KEY).toBe("public-browser-key");
  });

  it("serves static Vite output and routes services before SPA fallback", () => {
    const resolved = createDeploymentConfiguration(configuration, environment);
    expect(resolved.hosting.public).toBe("website/dist");
    expect(resolved.hosting.site).toBe("example-site");
    expect(resolved.hosting.predeploy).toContain("pnpm --filter @tinytldr/website... build");
    expect(resolved.hosting.ignore).toContain("**/*.map");
    expect(resolved.hosting.rewrites).toEqual([
      { source: "/v1/**", run: { serviceId: "website-api", region: "us-central1" } },
      {
        source: "/api/designs{,/**}",
        function: { functionId: "designs", region: "us-central1" },
      },
      { source: "/api/media{,/**}", function: { functionId: "media", region: "us-central1" } },
      { source: "/api/ai{,/**}", function: { functionId: "ai", region: "us-central1" } },
      { source: "**", destination: "/index.html" },
    ]);
    expect(JSON.stringify(resolved.hosting)).not.toContain("mcp.tinytldr.com");
    expect(configuration.hosting.rewrites[0].run.serviceId).toBe("tinytldr-api");
  });

  it("uses immutable hashed assets and no-store API responses with baseline security headers", () => {
    const rules = configuration.hosting.headers;
    expect(rules.find((rule) => rule.source === "/assets/**").headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    });
    expect(rules.find((rule) => rule.source === "/v1/**").headers).toContainEqual({
      key: "Cache-Control",
      value: "private, no-store",
    });
    expect(rules.find((rule) => rule.source === "**").headers).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
  });

  it("builds the Firebase-only website with same-origin API endpoints by default", () => {
    const build = websiteEnvironment(environment);
    expect(build.VITE_TINYTLDR_FIREBASE_PROJECT_ID).toBe("example-project");
    expect(build.VITE_TINYTLDR_FIREBASE_DESIGNS_URL).toBe("/api/designs");
    expect(build.VITE_TINYTLDR_FIREBASE_AI_URL).toBe("/api/ai");
    expect(build.VITE_TINYTLDR_FIREBASE_MEDIA_URL).toBe("/api/media");
    expect(configuration.storage.rules).toBe("website/firebase/storage.rules");
    expect(build.VITE_TINYTLDR_API_URL).toBe("https://api.tinytldr.com");
    expect(build).not.toHaveProperty("VITE_TINYTLDR_API_KEY");
    expect(() => websiteEnvironment({})).toThrow("FIREBASE_API_KEY");
  });

  it("explicitly deploys a separate resource-limited API service with ADC and no MCP changes", () => {
    const commands = apiDeploymentCommands(environment);
    expect(commands[0][1]).toContainEqual(expect.stringContaining("cloudbuild.api.yaml"));
    const deploy = commands[1][1];
    expect(deploy.slice(0, 3)).toEqual(["run", "deploy", "website-api"]);
    expect(deploy).toContain("--allow-unauthenticated");
    expect(deploy[deploy.indexOf("--concurrency") + 1]).toBe("4");
    expect(deploy[deploy.indexOf("--memory") + 1]).toBe("2Gi");
    expect(deploy[deploy.indexOf("--max") + 1]).toBe("2");
    expect(deploy[deploy.indexOf("--set-env-vars") + 1]).toContain(
      "TINYTLDR_API_ALLOWED_ORIGINS=https://www.tinytldr.com",
    );
    expect(JSON.stringify(commands)).not.toMatch(/MCP_ISSUER|mcp\.tinytldr\.com|SUPABASE/);
  });

  it("supports API origin overrides and multiple explicitly allowed website origins", () => {
    const commands = apiDeploymentCommands({
      ...environment,
      TINYTLDR_API_PUBLIC_URL: "https://api.tinytldr.com",
      TINYTLDR_API_ALLOWED_ORIGINS: "https://www.tinytldr.com,https://tinytldr.com",
    });
    expect(commands[1][1].at(-2)).toContain("TINYTLDR_API_PUBLIC_URL=https://api.tinytldr.com");
    expect(() =>
      apiDeploymentCommands({ ...environment, TINYTLDR_API_ALLOWED_ORIGINS: "*" }),
    ).toThrow();
    expect(() =>
      apiDeploymentCommands({ ...environment, TINYTLDR_API_SERVICE_ID: "mcp; bad" }),
    ).toThrow();
  });
});
