import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GetSavedDesignToolSchema,
  HOSTED_MCP_DESIGN_LIST_LIMIT,
  SavedDesignSummarySchema,
  type SavedDesignSummary,
  type SavedWorkspaceDesign,
} from "@tinytldr/core";
import { readOnlyTool } from "./ToolAnnotations.js";

/** Saved designs of the account that authorized the current MCP request. */
export interface SavedDesignSource {
  list(): Promise<readonly SavedWorkspaceDesign[]>;
  get(designId: string): Promise<SavedWorkspaceDesign>;
}

const REUSE_GUIDANCE =
  "To reuse this design as a template: keep each page's template, theme and tokenOverrides; replace the copy in pages[].data, respecting pages[].template.manifest.slots (maxLength, minItems/maxItems). Only edit text hard-coded in template.liquidTemplate when no slot holds it, and keep its markup and CSS. Then call render_workspace with this document and a format. The saved design is not modified.";

function summarize(design: SavedWorkspaceDesign): SavedDesignSummary {
  return SavedDesignSummarySchema.parse({
    id: design.id,
    title: design.document.title,
    size: design.document.size,
    revision: design.revision,
    updatedAt: design.updated_at,
    pages: design.document.pages.map((page) => ({
      id: page.id,
      title: page.title,
      description: page.description,
      template: page.template.manifest.name,
      slots: Object.keys(page.template.manifest.slots),
    })),
  });
}

export function registerDesignTools(server: McpServer, designs: SavedDesignSource) {
  server.registerTool(
    "list_designs",
    {
      title: "List saved designs",
      description: `List the signed-in user's saved tinytldr website designs (newest first, up to ${HOSTED_MCP_DESIGN_LIST_LIMIT}) with their ids, sizes, page titles, page descriptions and slot names. Read-only.`,
      annotations: readOnlyTool("List saved designs"),
      inputSchema: {},
    },
    async () => {
      const summaries = (await designs.list()).map(summarize);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                designs: summaries,
                nextStep:
                  summaries.length > 0
                    ? "Call get_design with the matching id, then render_workspace."
                    : "This account has no saved designs. Use list_templates for built-in templates.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_design",
    {
      title: "Get saved design",
      description:
        "Get one of the signed-in user's saved designs as a renderable version-2 design JSON document, including each page's template manifest, slot limits and current data. Read-only.",
      annotations: readOnlyTool("Get saved design"),
      inputSchema: GetSavedDesignToolSchema.shape,
    },
    async ({ designId }) => {
      const design = await designs.get(designId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: design.id,
                revision: design.revision,
                updatedAt: design.updated_at,
                document: design.document,
                nextStep: REUSE_GUIDANCE,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
