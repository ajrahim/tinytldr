import type { SizePresetId, TemplateKind } from "@tinytldr/core";
import type { CustomDimensions } from "./BrowserCompiler.js";

export interface SnippetDesignInput {
  readonly templateId: string;
  readonly templateKind: TemplateKind;
  readonly size: SizePresetId | CustomDimensions;
  readonly theme: string;
  readonly data: Record<string, unknown>;
}

export const HOSTED_MCP_URL = "https://mcp.tinytldr.com/mcp";

export function buildHostedMcpInstallCommands(): {
  readonly claude: string;
  readonly codex: string;
  readonly mcpJson: string;
} {
  return {
    claude: `claude mcp add --transport http tinytldr ${HOSTED_MCP_URL}`,
    codex: `codex mcp add tinytldr --url ${HOSTED_MCP_URL}`,
    mcpJson: JSON.stringify(
      { mcpServers: { tinytldr: { type: "http", url: HOSTED_MCP_URL } } },
      null,
      2,
    ),
  };
}

export function buildCodexInstallCommands(): {
  readonly cliCommand: string;
  readonly configToml: string;
} {
  return {
    cliCommand: `codex mcp add tinytldr -- npx -y tinytldr mcp`,
    configToml: `[mcp_servers.tinytldr]
command = "npx"
args = ["-y", "tinytldr", "mcp"]`,
  };
}

export function buildClaudeCodeInstallCommands(): {
  readonly cliCommand: string;
  readonly mcpJson: string;
} {
  return {
    cliCommand: `claude mcp add tinytldr -- npx -y tinytldr mcp`,
    mcpJson: JSON.stringify(
      {
        mcpServers: {
          tinytldr: {
            command: "npx",
            args: ["-y", "tinytldr", "mcp"],
          },
        },
      },
      null,
      2,
    ),
  };
}

export function buildMcpToolCallJson(input: SnippetDesignInput): string {
  const defaultFormat =
    input.templateKind === "video" ? "mp4" : input.templateKind === "carousel" ? "pdf" : "png";

  const payload = {
    tool: "render_post",
    arguments: {
      templateId: input.templateId,
      size: input.size,
      theme: input.theme,
      format: defaultFormat,
      scale: 1,
      data: input.data,
    },
  };

  return JSON.stringify(payload, null, 2);
}

export function buildCliRenderCommand(input: SnippetDesignInput): string {
  const defaultFormat =
    input.templateKind === "video" ? "mp4" : input.templateKind === "carousel" ? "pdf" : "png";
  const sizeArg =
    typeof input.size === "string"
      ? `--size ${input.size}`
      : `--size ${input.size.width}x${input.size.height}`;

  return `npx tinytldr render ${input.templateId} ${sizeArg} --theme ${input.theme} --format ${defaultFormat} --data ./slots.json --out ./${input.templateId}.${defaultFormat}`;
}

export function buildAgentPromptSnippet(input: SnippetDesignInput): string {
  const sizeLabel =
    typeof input.size === "string" ? input.size : `${input.size.width}x${input.size.height}`;
  return `Distill the active context into the tinytldr '${input.templateId}' template (${sizeLabel}, ${input.theme} theme). First call preview_post to verify zero overflow or contrast warnings, then export with render_post.`;
}
