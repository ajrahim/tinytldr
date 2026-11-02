import { build } from "esbuild";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
await mkdir(new URL("dist/", root), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("src/index.ts", root))],
  outfile: fileURLToPath(new URL("dist/index.js", root)),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "bundle",
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
});
await writeFile(
  new URL("dist/package.json", root),
  JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    private: true,
    license: manifest.license,
    type: "module",
    main: "index.js",
    engines: { node: "22" },
    dependencies: {
      "firebase-admin": manifest.dependencies["firebase-admin"],
      "firebase-functions": manifest.dependencies["firebase-functions"],
    },
  }),
);

// Firebase sets GCLOUD_PROJECT for predeploy hooks; scripts/DeployHosted.mjs sets the other.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.TINYTLDR_FIREBASE_PROJECT_ID;
if (projectId !== undefined && !/^[a-z][a-z0-9-]{3,}$/.test(projectId)) {
  throw new Error(`Invalid Firebase project ID: ${projectId}`);
}

const environmentFile = projectId === undefined ? undefined : `.env.${projectId}`;
for (const entry of await readdir(new URL("dist/", root), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.startsWith(".env."))
    await unlink(new URL(`dist/${entry.name}`, root));
}
if (environmentFile === undefined || !existsSync(new URL(environmentFile, root))) {
  console.warn(
    "No Firebase deployment environment found. Configure allowed origins in website/firebase/.env.<project-id> before deploying.",
  );
} else {
  await copyFile(new URL(environmentFile, root), new URL(`dist/${environmentFile}`, root));
}
