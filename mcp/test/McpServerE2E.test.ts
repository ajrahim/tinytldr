import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectPngHeader } from "@tinytldr/renderer";
import { createTinytldrMcpServer, type TinytldrMcpServerInstance } from "../src/index.js";
import { runDoctor } from "../../packages/cli/src/index.js";
import { WorkspaceDesignDocumentSchema } from "@tinytldr/core";
import { getTemplateBundle } from "@tinytldr/templates";

describe("Phase 1: MCP Server End-to-End & Doctor Check", () => {
  let mcpInstance: TinytldrMcpServerInstance;
  let client: Client;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tinytldr-mcp-e2e-"));
    mcpInstance = createTinytldrMcpServer();
    client = new Client({
      name: "tinytldr-test-client",
      version: "0.1.0",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpInstance.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await mcpInstance.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("exposes all 6 MCP tools and 2 MCP prompts", async () => {
    const toolsList = await client.listTools();
    const toolNames = toolsList.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      "get_template_schema",
      "list_templates",
      "preview_post",
      "render_post",
      "render_workspace",
      "validate_template_data",
    ]);

    const promptsList = await client.listPrompts();
    const promptNames = promptsList.prompts.map((p) => p.name).sort();
    expect(promptNames).toEqual(["distill_to_post", "repurpose_content"]);

    const promptResult = await client.getPrompt({
      name: "distill_to_post",
      arguments: {
        source: "tinytldr renders 150 frames in 3.44s on Windows 11.",
        platform: "x",
      },
    });
    expect(promptResult.messages[0]?.content.type).toBe("text");
    expect(promptResult.messages[0]?.content).toMatchObject({
      text: expect.stringContaining("save the final artifact to disk"),
    });
    const repurpose = await client.getPrompt({
      name: "repurpose_content",
      arguments: { source: "Keep the existing local export workflow." },
    });
    expect(repurpose.messages[0]?.content).toMatchObject({
      text: expect.stringContaining("then export via 'render_post'."),
    });
  });

  it("executes full MCP flow: list_templates -> get_template_schema -> validate_template_data -> preview_post -> render_post", async () => {
    const listRes = await client.callTool({
      name: "list_templates",
      arguments: { kind: "static" },
    });
    const listContent = (listRes.content as Array<{ type: string; text?: string }>)[0];
    const parsedList = JSON.parse(listContent?.text ?? "{}") as {
      templates: Array<{ id: string }>;
    };
    const ids = parsedList.templates.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["quote-card", "stat-callout", "code-snippet"]));

    const schemaRes = await client.callTool({
      name: "get_template_schema",
      arguments: { templateId: "code-snippet" },
    });
    const schemaText = (schemaRes.content as Array<{ type: string; text?: string }>)[0]?.text;
    const manifest = JSON.parse(schemaText ?? "{}") as {
      id: string;
      slots: Record<string, unknown>;
    };
    expect(manifest.id).toBe("code-snippet");
    expect(manifest.slots).toHaveProperty("code");

    const validateRes = await client.callTool({
      name: "validate_template_data",
      arguments: {
        templateId: "code-snippet",
        data: {
          title: "Zero-LLM Deterministic Rendering",
          filename: "mcp.ts",
          language: "typescript",
          code: "const result = await renderTemplatePost({\n  templateId: 'code-snippet',\n  outputPath: './post.png',\n});",
          annotation: "Runs locally in Playwright Chromium with bundled OFL fonts.",
        },
        size: "square",
      },
    });
    const validateJson = JSON.parse(
      (validateRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}",
    ) as { valid: boolean; warnings: string[] };
    expect(validateJson.valid).toBe(true);
    expect(validateJson.warnings).toEqual([]);

    const previewRes = await client.callTool({
      name: "preview_post",
      arguments: {
        templateId: "quote-card",
        theme: "paper",
      },
    });
    const previewBlocks = previewRes.content as Array<{
      type: string;
      data?: string;
      mimeType?: string;
      text?: string;
    }>;
    expect(previewBlocks[0]?.type).toBe("image");
    expect(previewBlocks[0]?.mimeType).toBe("image/png");
    const previewBuffer = Buffer.from(previewBlocks[0]?.data ?? "", "base64");
    expect(inspectPngHeader(previewBuffer)).toEqual({ width: 1080, height: 1080 });

    const outPath = path.join(tempDir, "mcp-rendered-code.png");
    const renderRes = await client.callTool({
      name: "render_post",
      arguments: {
        templateId: "code-snippet",
        size: "square",
        format: "png",
        outputPath: outPath,
      },
    });
    const renderBlocks = renderRes.content as Array<{
      type: string;
      text?: string;
    }>;
    const renderMeta = JSON.parse(renderBlocks[1]?.text ?? "{}") as {
      outputPaths: string[];
      width: number;
      height: number;
      bytes: number;
      warnings: string[];
    };
    expect(renderMeta.outputPaths).toEqual([outPath]);
    expect(renderMeta.width).toBe(1080);
    expect(renderMeta.height).toBe(1080);
    expect(renderMeta.bytes).toBeGreaterThan(20000);
    expect(renderMeta.warnings).toEqual([]);
    expect(fs.existsSync(outPath)).toBe(true);
  }, 30000);

  it("verifies tinytldr doctor reports Chromium, FFmpeg, and all 10 OFL fonts healthy", async () => {
    const report = await runDoctor();
    expect(report.ok).toBe(true);
    expect(report.chromiumOk).toBe(true);
    expect(report.ffmpegOk).toBe(true);
    expect(report.fontsOk).toBe(true);
    expect(report.fontCount).toBe(10);
    expect(report.missingFontFiles).toEqual([]);
  }, 20000);

  it("accepts the authoritative multipage workspace schema over MCP and returns ordered files with a bounded preview only", async () => {
    const template = structuredClone(getTemplateBundle("quote-card"));
    const document = WorkspaceDesignDocumentSchema.parse({
      version: 2,
      title: "Agent artboards",
      size: { width: 1024, height: 512 },
      pages: [
        {
          id: "page-1",
          title: "Page 1",
          description: "",
          template,
          data: template.manifest.sampleData,
          theme: template.manifest.defaultTheme,
          tokenOverrides: {},
        },
      ],
    });
    document.pages[0]!.description = "Introduce the claim.";
    document.pages.push({
      ...structuredClone(document.pages[0]!),
      id: "evidence",
      title: "Evidence",
      description: "Back up the claim.",
    });
    const result = await client.callTool({
      name: "render_workspace",
      arguments: { document, format: "png", outputPath: path.join(tempDir, "artboards.png") },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; data?: string; text?: string }>;
    expect(inspectPngHeader(Buffer.from(content[0]!.data!, "base64"))).toEqual({
      width: 768,
      height: 384,
    });
    const metadata = JSON.parse(content[1]!.text!);
    expect(metadata.outputPaths.map((file: string) => path.basename(file))).toEqual([
      "artboards-page-01.png",
      "artboards-page-02.png",
    ]);
    expect(metadata.pageCount).toBe(2);
    expect(metadata).not.toHaveProperty("previewDataUrl");
    for (const file of metadata.outputPaths)
      expect(inspectPngHeader(fs.readFileSync(file))).toEqual({ width: 1024, height: 512 });
  });
});
