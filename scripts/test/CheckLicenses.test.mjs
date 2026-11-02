import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPermissiveLicense, resolveInstalledPackageJson } from "../CheckLicenses.mjs";

describe("Permissive dependency license expressions", () => {
  it.each([
    "MIT",
    "MIT-0",
    "Zlib",
    "(MIT AND Zlib)",
    "(MPL-2.0 OR Apache-2.0)",
    "Apache-2.0 OR MPL-2.0",
    "(MIT OR MPL-2.0) AND Apache-2.0",
    "MIT AND (MPL-2.0 OR Apache-2.0)",
    "MIT / ISC",
  ])("accepts an available fully permissive licensing choice: %s", (license) => {
    expect(isPermissiveLicense(license)).toBe(true);
  });

  describe("Production dependency discovery", () => {
    it("finds sibling dependencies from a scoped package in pnpm's virtual store", () => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-licenses-"));
      try {
        const modules = path.join(fixture, "node_modules", ".pnpm", "sdk@1.0.0", "node_modules");
        const manifest = path.join(modules, "@example", "auth", "package.json");
        fs.mkdirSync(path.dirname(manifest), { recursive: true });
        fs.writeFileSync(manifest, JSON.stringify({ name: "@example/auth", license: "MIT" }));
        const source = path.join(modules, "@example", "sdk");
        expect(resolveInstalledPackageJson("@example/auth", [source])).toBe(manifest);
        expect(resolveInstalledPackageJson("@missing/dependency", [source])).toBeNull();
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    });
  });

  it.each([
    "",
    "MPL-2.0",
    "MPL-2.0 AND Apache-2.0",
    "(MIT OR Apache-2.0) AND MPL-2.0",
    "MIT AND (Apache-2.0 OR MPL-2.0) AND MPL-2.0",
    "(MIT OR Apache-2.0",
    "MIT OR",
    "MIT OR )",
    "MIT WITH unknown-exception",
    "GPL-3.0 OR MIT",
    "Zlib AND GPL-3.0",
    "AGPL-3.0",
    "Proprietary",
  ])(
    "rejects copyleft obligations, malformed expressions, or explicitly banned alternatives: %s",
    (license) => {
      expect(isPermissiveLicense(license)).toBe(false);
    },
  );
});
