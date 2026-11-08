import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIREBASE_TOOLS_VERSION = "15.34.2";
const DEFAULT_TARGETS = "firestore,storage,functions:tinytldr,hosting";
// Without a trailing separator so a quoted Windows argument cannot end in `\"`.
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .hosted/hosted.env.`);
  return value;
}

function identifier(value, name) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value))
    throw new Error(`${name} must be a lowercase Google Cloud identifier.`);
  return value;
}

function httpsOrigin(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value)
    throw new Error(`${name} must be an HTTPS origin without a trailing slash.`);
  return value;
}

export function createDeploymentConfiguration(base, environment) {
  const configuration = structuredClone(base);
  configuration.hosting.site = required(environment, "TINYTLDR_FIREBASE_HOSTING_SITE");
  for (const rewrite of configuration.hosting.rewrites) {
    if (rewrite.run) {
      rewrite.run.serviceId = identifier(
        required(environment, "TINYTLDR_API_SERVICE_ID"),
        "TINYTLDR_API_SERVICE_ID",
      );
      rewrite.run.region = identifier(
        required(environment, "TINYTLDR_API_REGION"),
        "TINYTLDR_API_REGION",
      );
    }
    if (rewrite.function)
      rewrite.function.region = identifier(
        environment.TINYTLDR_FIREBASE_FUNCTIONS_REGION ?? "us-central1",
        "TINYTLDR_FIREBASE_FUNCTIONS_REGION",
      );
  }
  const apiSite = environment.TINYTLDR_API_HOSTING_SITE?.trim();
  if (apiSite) {
    if (apiSite === configuration.hosting.site)
      throw new Error("The API and website must use separate Firebase Hosting sites.");
    configuration.hosting = [
      configuration.hosting,
      {
        site: apiSite,
        headers: [
          {
            source: "**",
            headers: [{ key: "Cache-Control", value: "private, no-store" }],
          },
        ],
        rewrites: [
          {
            source: "**",
            run: {
              serviceId: environment.TINYTLDR_API_SERVICE_ID,
              region: environment.TINYTLDR_API_REGION,
            },
          },
        ],
      },
    ];
  }
  return configuration;
}

export function websiteEnvironment(environment) {
  return {
    ...environment,
    VITE_TINYTLDR_FIREBASE_API_KEY: required(environment, "FIREBASE_API_KEY"),
    VITE_TINYTLDR_FIREBASE_APP_ID: required(environment, "FIREBASE_APP_ID"),
    VITE_TINYTLDR_FIREBASE_PROJECT_ID: required(environment, "TINYTLDR_FIREBASE_PROJECT_ID"),
    VITE_TINYTLDR_FIREBASE_AUTH_DOMAIN: required(environment, "FIREBASE_AUTH_DOMAIN"),
    VITE_TINYTLDR_FIREBASE_DESIGNS_URL:
      environment.VITE_TINYTLDR_FIREBASE_DESIGNS_URL ?? "/api/designs",
    // AI generations can run for minutes; Hosting rewrites cut requests off at 60 s, so the
    // site calls the function directly (it already allows the website origin via CORS).
    VITE_TINYTLDR_FIREBASE_AI_URL:
      environment.VITE_TINYTLDR_FIREBASE_AI_URL ??
      `https://${environment.TINYTLDR_FIREBASE_FUNCTIONS_REGION ?? "us-central1"}-${required(environment, "TINYTLDR_FIREBASE_PROJECT_ID")}.cloudfunctions.net/ai`,
    VITE_TINYTLDR_FIREBASE_MEDIA_URL: environment.VITE_TINYTLDR_FIREBASE_MEDIA_URL ?? "/api/media",
    VITE_TINYTLDR_API_URL:
      environment.VITE_TINYTLDR_API_URL ??
      environment.TINYTLDR_API_PUBLIC_URL ??
      "https://api.tinytldr.com",
  };
}

export function createFirebaseDeploymentPlan(base, environment, targets = DEFAULT_TARGETS) {
  const hasHosting = targets.split(",").some((target) => target.trim().split(":")[0] === "hosting");
  return {
    configuration: hasHosting ? createDeploymentConfiguration(base, environment) : undefined,
    environment: hasHosting ? websiteEnvironment(environment) : environment,
  };
}

export function apiDeploymentCommands(environment) {
  const project = identifier(
    required(environment, "TINYTLDR_FIREBASE_PROJECT_ID"),
    "TINYTLDR_FIREBASE_PROJECT_ID",
  );
  const service = identifier(
    required(environment, "TINYTLDR_API_SERVICE_ID"),
    "TINYTLDR_API_SERVICE_ID",
  );
  const region = identifier(required(environment, "TINYTLDR_API_REGION"), "TINYTLDR_API_REGION");
  const image = required(environment, "TINYTLDR_API_IMAGE");
  if (!/^[a-z0-9.-]+-docker\.pkg\.dev\/[a-z0-9-]+\/[a-z0-9._/-]+:[a-z0-9._-]+$/i.test(image))
    throw new Error("TINYTLDR_API_IMAGE must be a tagged Artifact Registry image.");
  const account = required(environment, "TINYTLDR_API_SERVICE_ACCOUNT");
  if (!/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account))
    throw new Error("TINYTLDR_API_SERVICE_ACCOUNT must be a service account email.");
  const publicUrl = httpsOrigin(
    environment.TINYTLDR_API_PUBLIC_URL ?? "https://api.tinytldr.com",
    "TINYTLDR_API_PUBLIC_URL",
  );
  const origins = (environment.TINYTLDR_API_ALLOWED_ORIGINS ?? "https://www.tinytldr.com")
    .split(",")
    .map((origin) => httpsOrigin(origin.trim(), "TINYTLDR_API_ALLOWED_ORIGINS"))
    .join(",");
  const runtime = {
    TINYTLDR_FIREBASE_PROJECT_ID: project,
    TINYTLDR_API_DATABASE_ID: environment.TINYTLDR_API_DATABASE_ID ?? "(default)",
    TINYTLDR_API_ARTIFACT_BUCKET: required(environment, "TINYTLDR_API_ARTIFACT_BUCKET"),
    TINYTLDR_API_PUBLIC_URL: publicUrl,
    TINYTLDR_API_ALLOWED_ORIGINS: origins,
  };
  if (Object.values(runtime).some((value) => /[|\r\n]/.test(value)))
    throw new Error("API runtime configuration contains an invalid delimiter.");
  return [
    [
      "gcloud",
      [
        "builds",
        "submit",
        root,
        "--project",
        project,
        "--config",
        path.join(root, "cloudbuild.api.yaml"),
        "--substitutions",
        `_IMAGE=${image}`,
        "--quiet",
      ],
    ],
    [
      "gcloud",
      [
        "run",
        "deploy",
        service,
        "--project",
        project,
        "--region",
        region,
        "--image",
        image,
        "--service-account",
        account,
        "--allow-unauthenticated",
        "--ingress",
        "all",
        "--port",
        "8080",
        "--cpu",
        "2",
        "--memory",
        "2Gi",
        "--concurrency",
        "4",
        "--min",
        "0",
        "--max",
        "2",
        "--timeout",
        "180s",
        "--set-env-vars",
        `^|^${Object.entries(runtime)
          .map(([key, value]) => `${key}=${value}`)
          .join("|")}`,
        "--quiet",
      ],
    ],
  ];
}

export function run(command, args, environment = process.env) {
  const windows = process.platform === "win32";
  if (!/^[a-z][a-z0-9-]*$/i.test(command))
    throw new Error("Deployment command must be a plain executable name.");
  const quote = (value) => {
    if (/["%\r\n]/.test(value)) throw new Error("Deployment argument contains unsafe characters.");
    return `"${value}"`;
  };
  const result = spawnSync(
    windows ? [command, ...args.map(quote)].join(" ") : command,
    windows ? [] : args,
    {
      cwd: root,
      env: environment,
      stdio: "inherit",
      shell: windows,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}.`);
}

function main() {
  const configPath = path.join(root, ".hosted", "hosted.env");
  if (!existsSync(configPath))
    throw new Error("Copy .hosted.example/hosted.env to .hosted/hosted.env and fill it in.");
  process.loadEnvFile(configPath);
  const projectId = identifier(
    required(process.env, "TINYTLDR_FIREBASE_PROJECT_ID"),
    "TINYTLDR_FIREBASE_PROJECT_ID",
  );
  const targets = process.argv[2] ?? DEFAULT_TARGETS;
  if (targets === "api") {
    for (const [command, args] of apiDeploymentCommands(process.env)) run(command, args);
    return;
  }
  const base = JSON.parse(readFileSync(path.join(root, "firebase.json"), "utf8"));
  const plan = createFirebaseDeploymentPlan(base, process.env, targets);
  const generated = plan.configuration
    ? path.join(root, `firebase.hosted.${process.pid}.generated.json`)
    : undefined;
  try {
    if (generated)
      writeFileSync(generated, JSON.stringify(plan.configuration, null, 2), { flag: "wx" });
    run(
      "npx",
      [
        "--yes",
        `firebase-tools@${FIREBASE_TOOLS_VERSION}`,
        "deploy",
        "--project",
        projectId,
        ...(generated ? ["--config", generated] : []),
        "--only",
        targets,
        "--non-interactive",
      ],
      plan.environment,
    );
  } finally {
    if (generated) rmSync(generated, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Hosted deployment failed.");
    process.exitCode = 1;
  }
}
