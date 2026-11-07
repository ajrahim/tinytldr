import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createZip, listFiles, plugins, repoRoot, staleSkillCopies } from "../PluginPackages.mjs";

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(repoRoot, ...parts), "utf8"));
const server = readJson("server.json");
const remoteUrl = server.remotes.find((remote) => remote.transport_type === "streamable-http").url;
const claudeManifest = readJson("plugin", "claude", ".claude-plugin", "plugin.json");
const claudeMcp = readJson("plugin", "claude", ".mcp.json");
const codexManifest = readJson("plugin", "codex", "plugin.json");
const codexMcp = readJson("plugin", "codex", "mcp.json");
const openai = codexManifest.extensions["com.openai"];

function pngSize(file) {
  const data = fs.readFileSync(file);
  expect(data.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, zlib.inflateRawSync(buffer.subarray(start, start + compressedSize)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("Agent plugin packages", () => {
  it("ships plugin skill copies identical to skills/tinytldr", () => {
    expect(staleSkillCopies()).toEqual([]);
  });

  it("keeps plugin identity aligned with server.json", () => {
    for (const manifest of [claudeManifest, codexManifest]) {
      expect(manifest.name).toBe("tinytldr");
      expect(manifest.version).toBe(server.version);
      expect(manifest.license).toBe(server.license);
      expect(manifest.repository).toBe(server.repository.url);
    }
  });

  it("connects only the hosted MCP server without bundled secrets", () => {
    expect(claudeMcp.mcpServers).toEqual({ tinytldr: { type: "http", url: remoteUrl } });
    expect(Object.keys(codexMcp.mcpServers)).toEqual(["tinytldr"]);
    const codexServer = codexMcp.mcpServers.tinytldr;
    expect(codexServer).toMatchObject({ type: "streamable-http", url: remoteUrl });
    expect(codexServer.headers).toBeUndefined();
    expect(codexServer.extensions["com.openai"].auth).toEqual({
      type: "oauth",
      client: { mode: "dcr" },
      baseScopes: ["mcp:render"],
    });
  });

  it("meets the OpenAI listing and review requirements", () => {
    const { interface: listing, review } = openai;
    expect(listing.displayName.length).toBeLessThanOrEqual(30);
    expect(listing.shortDescription.length).toBeLessThanOrEqual(30);
    expect(review.test_cases.positive).toHaveLength(5);
    expect(review.test_cases.negative).toHaveLength(3);
    for (const testCase of review.test_cases.positive) {
      expect(
        testCase.prompt && testCase.tools_triggered && testCase.expected_behavior,
      ).toBeTruthy();
    }
    for (const url of [
      listing.websiteURL,
      listing.supportURL,
      listing.privacyPolicyURL,
      listing.termsOfServiceURL,
    ]) {
      expect(url).toMatch(/^https:\/\//);
    }
    expect(fs.existsSync(path.join(plugins.codex, "hooks"))).toBe(false);
  });

  it("references square PNG icons that exist in each package", () => {
    const listing = openai.interface;
    const icons = [
      [plugins.claude, claudeManifest.icon],
      ...["composerIcon", "composerIconDark", "logo", "logoDark"].map((key) => [
        plugins.codex,
        listing[key],
      ]),
    ];
    for (const [root, icon] of icons) {
      const { width, height } = pngSize(path.join(root, icon));
      expect(width).toBe(height);
      expect(width).toBeGreaterThanOrEqual(256);
    }
  });

  it("lists each plugin in its repository marketplace", () => {
    const claudeMarketplace = readJson(".claude-plugin", "marketplace.json");
    const codexMarketplace = readJson(".agents", "plugins", "marketplace.json");
    expect(claudeMarketplace.plugins).toEqual([
      expect.objectContaining({ name: "tinytldr", source: "./plugin/claude" }),
    ]);
    expect(codexMarketplace.plugins).toEqual([
      expect.objectContaining({
        name: "tinytldr",
        source: { source: "local", path: "./plugin/codex" },
      }),
    ]);
  });

  it("packs a deterministic ZIP whose entries round-trip", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-plugin-"));
    try {
      fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
      fs.writeFileSync(path.join(root, "plugin.json"), '{"name":"demo"}');
      fs.writeFileSync(path.join(root, "skills", "demo", "SKILL.md"), "# Demo\n".repeat(50));
      const zip = createZip(root);
      expect(createZip(root).equals(zip)).toBe(true);
      const entries = readZip(zip);
      expect([...entries.keys()]).toEqual(listFiles(root));
      expect(entries.get("skills/demo/SKILL.md").toString()).toBe("# Demo\n".repeat(50));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
