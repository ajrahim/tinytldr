import { artboardDocument, type WorkspaceProject } from "@tinytldr/core";
import { createTemplateJson } from "./TemplateEditor.js";

export interface WorkspaceSourceRecovery {
  pageJson?: Record<string, string>;
}

export function pageJsonValue(
  source: Record<string, string> | undefined,
  id: string,
): string | undefined {
  return source && Object.hasOwn(source, id) ? source[id] : undefined;
}

export function restorePageJson(
  project: WorkspaceProject,
  recovery: WorkspaceSourceRecovery = {},
): Record<string, string> {
  return Object.fromEntries(
    project.pages.map((page) => [
      page.id,
      pageJsonValue(recovery.pageJson, page.id) ??
        createTemplateJson(artboardDocument(page, project.size)),
    ]),
  );
}
