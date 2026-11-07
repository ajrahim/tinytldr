import {
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  symlink,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const firebaseRoot = new URL("../../website/firebase/", import.meta.url);
const directories = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tinytldr-firebase-build-"));
  directories.push(root);
  await Promise.all(["src", "scripts", "dist"].map((name) => mkdir(path.join(root, name))));
  await Promise.all([
    copyFile(new URL("scripts/Build.mjs", firebaseRoot), path.join(root, "scripts", "Build.mjs")),
    writeFile(path.join(root, "src", "index.ts"), "export const test = true;\n"),
    writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "test-functions",
        version: "0.0.0",
        license: "MIT",
        type: "module",
        dependencies: { "firebase-admin": "^13.0.0", "firebase-functions": "^6.0.0" },
      }),
    ),
    symlink(
      fileURLToPath(new URL("node_modules/", firebaseRoot)),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    ),
    writeFile(path.join(root, "dist", ".env.old-project"), "ONLY_OLD_PROJECT=true\n"),
    writeFile(path.join(root, ".env.demo-current"), "ONLY_CURRENT_PROJECT=true\n"),
  ]);
  return root;
}

function build(root, project) {
  const env = { ...process.env };
  delete env.GCLOUD_PROJECT;
  delete env.TINYTLDR_FIREBASE_PROJECT_ID;
  if (project !== undefined) env.TINYTLDR_FIREBASE_PROJECT_ID = project;
  return spawnSync(process.execPath, [path.join(root, "scripts", "Build.mjs")], {
    env,
    encoding: "utf8",
  });
}

afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Firebase deployment environment isolation", () => {
  it("loads bundled CommonJS dependencies that require Node built-ins in the deployed ESM output", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "src", "StreamFixture.cjs"),
      'module.exports = require("node:stream");\n',
    );
    await writeFile(
      path.join(root, "src", "index.ts"),
      'import stream from "./StreamFixture.cjs"; export const readable = stream.Readable;\n',
    );
    const result = build(root);
    expect(result.status, result.stderr).toBe(0);
    const entry = pathToFileURL(path.join(root, "dist", "index.js")).href;
    const loaded = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { readable } from ${JSON.stringify(entry)}; console.log(typeof readable);`,
      ],
      { encoding: "utf8" },
    );
    expect(loaded.status, loaded.stderr).toBe(0);
    expect(loaded.stdout.trim()).toBe("function");
  });

  it("copies only the explicitly selected project environment", async () => {
    const root = await fixture();
    const result = build(root, "demo-current");
    expect(result.status, result.stderr).toBe(0);
    const files = await readdir(path.join(root, "dist"));
    expect(files.filter((file) => file.startsWith(".env."))).toEqual([".env.demo-current"]);
    expect(await readFile(path.join(root, "dist", ".env.demo-current"), "utf8")).toBe(
      "ONLY_CURRENT_PROJECT=true\n",
    );
  });

  it("does not leave a previous project's environment in an unconfigured build", async () => {
    const root = await fixture();
    const result = build(root);
    expect(result.status, result.stderr).toBe(0);
    expect((await readdir(path.join(root, "dist"))).some((file) => file.startsWith(".env."))).toBe(
      false,
    );
    expect(result.stderr).toContain("No Firebase deployment environment found");
  });

  it("rejects malformed project selection", async () => {
    const root = await fixture();
    const result = build(root, "../other-project");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid Firebase project ID");
  });
});
