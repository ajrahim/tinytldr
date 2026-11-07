// Keeps the Claude Code and Codex plugin packages in sync with the canonical
// skill and builds their submission ZIPs.
//   node scripts/PluginPackages.mjs sync   copy skills/tinytldr into each plugin
//   node scripts/PluginPackages.mjs check  fail if a plugin copy is stale
//   node scripts/PluginPackages.mjs pack   sync, then write dist/plugins/*.zip
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const canonicalSkill = path.join(repoRoot, "skills", "tinytldr");
export const plugins = {
  claude: path.join(repoRoot, "plugin", "claude"),
  codex: path.join(repoRoot, "plugin", "codex"),
};

export function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

export function staleSkillCopies() {
  const expected = listFiles(canonicalSkill);
  const stale = [];
  for (const [name, root] of Object.entries(plugins)) {
    const target = path.join(root, "skills", "tinytldr");
    const actual = fs.existsSync(target) ? listFiles(target) : [];
    const same =
      actual.length === expected.length &&
      expected.every(
        (file, index) =>
          actual[index] === file &&
          fs
            .readFileSync(path.join(canonicalSkill, file))
            .equals(fs.readFileSync(path.join(target, file))),
      );
    if (!same) stale.push(name);
  }
  return stale;
}

export function syncSkills() {
  for (const root of Object.values(plugins)) {
    const target = path.join(root, "skills", "tinytldr");
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(canonicalSkill, target, { recursive: true });
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamp (1980-01-01) keeps archives byte-identical across runs.
export function createZip(root) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of listFiles(root)) {
    const name = Buffer.from(file, "utf8");
    const data = fs.readFileSync(path.join(root, file));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function pack(outDir = path.join(repoRoot, "dist", "plugins")) {
  syncSkills();
  fs.mkdirSync(outDir, { recursive: true });
  return Object.entries(plugins).map(([name, root]) => {
    const file = path.join(outDir, `tinytldr-${name}-plugin.zip`);
    fs.writeFileSync(file, createZip(root));
    return file;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "sync") {
    syncSkills();
    console.log("Synced skills/tinytldr into plugin/claude and plugin/codex.");
  } else if (command === "check") {
    const stale = staleSkillCopies();
    if (stale.length) {
      console.error(
        `Stale plugin skill copies: ${stale.join(", ")}. Run node scripts/PluginPackages.mjs sync.`,
      );
      process.exit(1);
    }
    console.log("Plugin skill copies match skills/tinytldr.");
  } else if (command === "pack") {
    for (const file of pack()) console.log(path.relative(repoRoot, file));
  } else {
    console.error("Usage: node scripts/PluginPackages.mjs <sync|check|pack>");
    process.exit(2);
  }
}
