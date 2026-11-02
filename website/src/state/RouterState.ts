import type { SizePresetId } from "../lib/BrowserCompiler.js";

export type RoutePageId = "playground" | "docs" | "authCallback";

export type DocsSectionId =
  "quickstart" | "workflow" | "tools" | "authoring" | "selfHost" | "contribute";

export interface ParsedRoute {
  readonly page: RoutePageId;
  readonly pathname: string;
  readonly templateId?: string;
  readonly initialSize?: SizePresetId;
  readonly initialTheme?: string;
  readonly docsSection?: DocsSectionId;
  readonly designId?: string;
  readonly localId?: string;
}

const VALID_PRESETS = new Set<SizePresetId>([
  "square",
  "portrait",
  "grid-3x4",
  "story",
  "hd",
  "x",
  "linkedin",
  "og",
  "youtube-thumb",
  "pinterest",
]);

export function resolveAuthReturnPath(next: string, origin: string): string {
  const target = new URL(next, origin);
  if (target.origin !== origin || /^\/auth(?:\/|$)/.test(target.pathname))
    throw new Error("The sign-in return path must be a non-authentication page on this site.");
  return `${target.pathname}${target.search}`;
}

export function parseLocationRoute(pathname: string, search: string): ParsedRoute {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);
  const rawSize = params.get("size");
  const initialSize =
    rawSize && VALID_PRESETS.has(rawSize as SizePresetId) ? (rawSize as SizePresetId) : undefined;
  const initialTheme = params.get("theme") ?? undefined;

  if (cleanPath === "/auth/callback") return { page: "authCallback", pathname: cleanPath };
  const designMatch = /^\/(d|local)\/([0-9a-f-]{36})$/i.exec(cleanPath);
  if (designMatch) {
    return {
      page: "playground",
      pathname: cleanPath,
      ...(designMatch[1] === "d" ? { designId: designMatch[2] } : { localId: designMatch[2] }),
    };
  }

  if (cleanPath.startsWith("/templates/")) {
    const templateId = decodeURIComponent(cleanPath.slice("/templates/".length));
    return {
      page: "playground",
      pathname: cleanPath,
      templateId,
      initialSize,
      initialTheme,
    };
  }

  if (["/", "/designs", "/templates", "/playground", "/studio"].includes(cleanPath)) {
    const queryTemplate = params.get("template") ?? undefined;
    return {
      page: "playground",
      pathname: cleanPath,
      templateId: queryTemplate,
      initialSize,
      initialTheme,
    };
  }

  if (cleanPath === "/docs/self-host") {
    return {
      page: "docs",
      pathname: "/docs/self-host",
      docsSection: "selfHost",
    };
  }

  if (cleanPath === "/contribute") {
    return {
      page: "docs",
      pathname: "/contribute",
      docsSection: "contribute",
    };
  }

  if (cleanPath.startsWith("/docs")) {
    const tabParam = params.get("section") as DocsSectionId | null;
    return {
      page: "docs",
      pathname: "/docs",
      docsSection: tabParam ?? "quickstart",
    };
  }

  return { page: "playground", pathname: "/" };
}
