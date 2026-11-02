import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const args = isWindows
  ? ["/d", "/s", "/c", "npm install --omit=dev --ignore-scripts"]
  : ["install", "--omit=dev", "--ignore-scripts"];
const result = spawnSync(command, args, {
  cwd: fileURLToPath(new URL("../dist/", import.meta.url)),
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Firebase deployment dependency installation failed (${result.status}).`);
