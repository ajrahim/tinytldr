import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED_LICENSES = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Zlib",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD",
  "Apache-2.0",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "OFL-1.1",
  "Python-2.0",
]);

const DISALLOWED_PATTERNS = [
  /\bAGPL\b/i,
  /\bGPL\b/i,
  /\bLGPL\b/i,
  /\bSSPL\b/i,
  /\bBUSL\b/i,
  /\bBSL\b/i,
  /\bRemotion\b/i,
  /\bProprietary\b/i,
  /\bUNLICENSED\b/i,
];

const DISALLOWED_PACKAGES = new Set(["gsap", "remotion", "@remotion/cli", "@remotion/renderer"]);

/**
 * Checks whether a SPDX license expression or string is permissible under tinytldr's MIT policy.
 */
export function isPermissiveLicense(licenseValue) {
  if (!licenseValue || typeof licenseValue !== "string") {
    return false;
  }

  const normalized = licenseValue.trim();

  for (const pattern of DISALLOWED_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  if (ALLOWED_LICENSES.has(normalized)) {
    return true;
  }

  const expression = normalized.replace(/[/,]/g, " AND ");
  const tokens = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*|[()]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) return false;

  let index = 0;
  let valid = true;
  const readPrimary = () => {
    const token = tokens[index++];
    if (token === "(") {
      const result = readOr();
      if (tokens[index++] !== ")") valid = false;
      return result;
    }
    if (!token || /^(AND|OR|\))$/i.test(token)) valid = false;
    return ALLOWED_LICENSES.has(token);
  };
  const readAnd = () => {
    let result = readPrimary();
    while (/^AND$/i.test(tokens[index] ?? "")) {
      index++;
      const next = readPrimary();
      result = result && next;
    }
    return result;
  };
  const readOr = () => {
    let result = readAnd();
    while (/^OR$/i.test(tokens[index] ?? "")) {
      index++;
      const next = readAnd();
      result = result || next;
    }
    return result;
  };

  // OR allows choosing a permissive license; AND requires every obligation.
  const result = readOr();
  return valid && index === tokens.length && result;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getWorkspacePackageJsonPaths(rootDir) {
  const paths = [path.join(rootDir, "package.json")];

  const packagesDir = path.join(rootDir, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const pkgPath = path.join(packagesDir, entry.name, "package.json");
        if (fs.existsSync(pkgPath)) {
          paths.push(pkgPath);
        }
      }
    }
  }

  for (const dirName of ["mcp", "website", path.join("website", "firebase")]) {
    const pkgPath = path.join(rootDir, dirName, "package.json");
    if (fs.existsSync(pkgPath)) {
      paths.push(pkgPath);
    }
  }

  return paths;
}

export function resolveInstalledPackageJson(depName, searchDirs) {
  for (const baseDir of searchDirs) {
    let directory = path.resolve(baseDir);
    while (true) {
      const candidate = path.join(directory, "node_modules", ...depName.split("/"), "package.json");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  return null;
}

function extractLicenseString(pkgJson) {
  if (typeof pkgJson.license === "string") {
    return pkgJson.license;
  }

  if (
    pkgJson.license &&
    typeof pkgJson.license === "object" &&
    typeof pkgJson.license.type === "string"
  ) {
    return pkgJson.license.type;
  }

  if (Array.isArray(pkgJson.licenses) && pkgJson.licenses.length > 0) {
    return pkgJson.licenses
      .map((item) => (typeof item === "string" ? item : item?.type))
      .filter(Boolean)
      .join(" OR ");
  }

  return "";
}

function runLicenseAudit() {
  const workspacePkgPaths = getWorkspacePackageJsonPaths(ROOT_DIR);
  const violations = [];
  const visited = new Map();
  const queue = [];

  for (const pkgPath of workspacePkgPaths) {
    const pkg = readJsonFile(pkgPath);
    const relPath = path.relative(ROOT_DIR, pkgPath);

    if (pkg.license !== "MIT") {
      violations.push(
        `${relPath}: workspace package license must be "MIT" (found "${pkg.license ?? "none"}")`,
      );
    }

    const prodDeps = Object.keys(pkg.dependencies ?? {});
    for (const depName of prodDeps) {
      if (DISALLOWED_PACKAGES.has(depName)) {
        violations.push(`${relPath}: disallowed dependency "${depName}"`);
        continue;
      }

      if (!depName.startsWith("@tinytldr/") && depName !== "tinytldr") {
        queue.push({ depName, searchDirs: [path.dirname(pkgPath), ROOT_DIR] });
      }
    }
  }

  while (queue.length > 0) {
    const { depName, searchDirs } = queue.shift();
    if (DISALLOWED_PACKAGES.has(depName)) {
      violations.push(`Production tree contains disallowed package "${depName}"`);
      continue;
    }

    const resolvedPkgPath = resolveInstalledPackageJson(depName, searchDirs);
    if (!resolvedPkgPath) {
      violations.push(
        `Cannot audit missing production dependency "${depName}"; restore dependencies before checking licenses.`,
      );
      continue;
    }

    const realPkgPath = fs.realpathSync(resolvedPkgPath);
    if (visited.has(realPkgPath)) {
      continue;
    }

    const depPkg = readJsonFile(realPkgPath);
    const license = extractLicenseString(depPkg);
    visited.set(realPkgPath, {
      name: depPkg.name ?? depName,
      version: depPkg.version ?? "0.0.0",
      license,
    });

    if (!isPermissiveLicense(license)) {
      violations.push(
        `Disallowed or unknown license in production dependency ${depPkg.name ?? depName}@${depPkg.version}: "${license || "missing"}"`,
      );
    }

    const nestedSearchDirs = [
      path.dirname(realPkgPath),
      path.resolve(path.dirname(realPkgPath), "../.."),
      ROOT_DIR,
    ];
    for (const childDep of Object.keys(depPkg.dependencies ?? {})) {
      if (!childDep.startsWith("@tinytldr/") && childDep !== "tinytldr") {
        queue.push({ depName: childDep, searchDirs: nestedSearchDirs });
      }
    }
  }

  if (violations.length > 0) {
    console.error("License check failed:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `License check passed: ${workspacePkgPaths.length} workspace manifests (all MIT) and ${visited.size} transitive production dependencies verified permissive.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLicenseAudit();
}
