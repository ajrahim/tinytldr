import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Tools that only read templates or saved designs, or render in memory without storing files. */
export function readOnlyTool(title: string): ToolAnnotations {
  return { title, readOnlyHint: true, openWorldHint: false };
}

/**
 * Export tools create new files. Hosted exports go to fresh private objects, so nothing is
 * overwritten; local exports write to a caller-chosen path that may replace an existing file.
 */
export function exportTool(title: string, overwrites: boolean): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: overwrites,
    idempotentHint: false,
    openWorldHint: false,
  };
}
