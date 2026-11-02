#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  SizeSpecSchema,
  TemplateKindSchema,
  type SizeSpec,
  type TemplateKind,
} from "@tinytldr/core";
import {
  listSizes,
  scaffoldNewTemplate,
  startStdioMcpServer,
  startTinytldrHttpServer,
  validateTemplateFullSuite,
} from "@tinytldr/mcp";
import {
  ChromiumRenderer,
  previewTemplatePost,
  renderTemplatePost,
  validateTemplatePost,
  type RenderOutputFormat,
} from "@tinytldr/renderer";
import { getTemplateManifest, listTemplates, verifyBundledFonts } from "@tinytldr/templates";

const execFileAsync = promisify(execFile);

export function getCliVersion(): string {
  return "0.1.0";
}

export { listSizes };

export interface DoctorReport {
  readonly ok: boolean;
  readonly chromiumOk: boolean;
  readonly ffmpegOk: boolean;
  readonly ffmpegVersion?: string;
  readonly fontsOk: boolean;
  readonly fontCount: number;
  readonly missingFontFiles: readonly string[];
}

export async function runDoctor(): Promise<DoctorReport> {
  const renderer = new ChromiumRenderer();
  let chromiumOk = false;
  try {
    const browser = await renderer.getBrowser();
    chromiumOk = browser.isConnected();
  } catch {
    chromiumOk = false;
  } finally {
    await renderer.close();
  }

  let ffmpegOk = false;
  let ffmpegVersion: string | undefined;
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-version"]);
    ffmpegOk = true;
    ffmpegVersion = stdout.split(/\r?\n/)[0]?.trim();
  } catch {
    ffmpegOk = false;
  }

  const fontStatus = verifyBundledFonts();

  return {
    ok: chromiumOk && ffmpegOk && fontStatus.ok,
    chromiumOk,
    ffmpegOk,
    ffmpegVersion,
    fontsOk: fontStatus.ok,
    fontCount: fontStatus.fontCount,
    missingFontFiles: fontStatus.missingFiles,
  };
}

function parseFlagMap(argv: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      map[key] = next;
      i++;
    } else {
      map[key] = "true";
    }
  }
  return map;
}

function parseSizeFlag(rawSize?: string): SizeSpec | undefined {
  if (!rawSize) return undefined;
  const customMatch = rawSize.match(/^(\d+)x(\d+)$/i);
  if (customMatch) {
    return SizeSpecSchema.parse({
      width: Number(customMatch[1]),
      height: Number(customMatch[2]),
    });
  }
  return SizeSpecSchema.parse(rawSize);
}

function readDataFlag(flags: Record<string, string>): Record<string, unknown> | undefined {
  const raw = flags.data;
  if (!raw) return undefined;
  if (raw.trim().startsWith("{")) {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  const abs = path.resolve(raw);
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help";
  const rest = argv.slice(1);
  const flags = parseFlagMap(rest);

  switch (command) {
    case "mcp": {
      await startStdioMcpServer();
      return 0;
    }

    case "list": {
      const kind = flags.kind ? (TemplateKindSchema.parse(flags.kind) as TemplateKind) : undefined;
      const templates = listTemplates({
        kind,
        tag: flags.tag,
        aspect: flags.aspect,
      });
      process.stdout.write(`${JSON.stringify(templates, null, 2)}\n`);
      return 0;
    }

    case "inspect": {
      const templateId = rest.find((a) => !a.startsWith("--")) ?? flags.template;
      if (!templateId) {
        process.stderr.write("Usage: tinytldr inspect <template-id>\n");
        return 1;
      }
      const manifest = getTemplateManifest(templateId);
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return 0;
    }

    case "validate": {
      const templateId = flags.template;
      if (!templateId) {
        process.stderr.write("Usage: tinytldr validate --template <id> [--data <file.json>]\n");
        return 1;
      }
      const manifest = getTemplateManifest(templateId);
      const data = readDataFlag(flags) ?? manifest.sampleData;
      const result = await validateTemplatePost({
        templateId,
        data,
        size: parseSizeFlag(flags.size),
        theme: flags.theme,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.valid ? 0 : 1;
    }

    case "preview": {
      const templateId = flags.template;
      if (!templateId) {
        process.stderr.write(
          "Usage: tinytldr preview --template <id> [--data <file.json>] [--out preview.png]\n",
        );
        return 1;
      }
      const data = readDataFlag(flags);
      const result = await previewTemplatePost({
        templateId,
        data,
        size: parseSizeFlag(flags.size),
        theme: flags.theme,
      });
      if (flags.out) {
        const outPath = path.resolve(flags.out);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, result.buffer);
      }
      process.stdout.write(
        `${JSON.stringify(
          {
            width: result.width,
            height: result.height,
            bytes: result.buffer.byteLength,
            outputPath: flags.out ? path.resolve(flags.out) : undefined,
            warnings: result.warnings,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    case "render": {
      const templateId = flags.template;
      const outPath = flags.out ?? flags.output;
      if (!templateId || !outPath) {
        process.stderr.write(
          "Usage: tinytldr render --template <id> --out <path> [--data <file.json>] [--size square] [--format png|jpg|webp|pdf|mp4] [--scale 1|2]\n",
        );
        return 1;
      }
      const data = readDataFlag(flags);
      const format = (flags.format ?? "png") as RenderOutputFormat;
      const scale = flags.scale === "2" ? 2 : 1;
      const result = await renderTemplatePost({
        templateId,
        data,
        size: parseSizeFlag(flags.size),
        theme: flags.theme,
        format,
        scale,
        outputPath: outPath,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    case "doctor": {
      const report = await runDoctor();
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.ok ? 0 : 1;
    }

    case "serve": {
      const port = flags.port ? Number(flags.port) : Number(process.env.PORT ?? 8787);
      const host = flags.host ?? "127.0.0.1";
      const handle = await startTinytldrHttpServer({
        port,
        host,
        apiKey: flags["api-key"] ?? process.env.TINYTLDR_API_KEY,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "listening",
            url: handle.url,
            mcpEndpoint: `${handle.url}/mcp`,
            healthEndpoint: `${handle.url}/health`,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    case "template": {
      const subcommand = rest[0];
      const positionalArgs = rest.slice(1).filter((a) => !a.startsWith("--"));
      const templateId = positionalArgs[0] ?? flags.template ?? flags.id;

      if (subcommand === "new") {
        if (!templateId) {
          process.stderr.write(
            "Usage: tinytldr template new <template-id> [--kind static|carousel|video] [--dir <targetDir>]\n",
          );
          return 1;
        }
        const kind = flags.kind ? (TemplateKindSchema.parse(flags.kind) as TemplateKind) : "static";
        const scaffolded = scaffoldNewTemplate({
          templateId,
          kind,
          name: flags.name,
          author: flags.author,
          targetRootDir: flags.dir,
        });
        process.stdout.write(`${JSON.stringify(scaffolded, null, 2)}\n`);
        return 0;
      }

      if (subcommand === "validate") {
        if (!templateId) {
          process.stderr.write(
            "Usage: tinytldr template validate <template-id> [--dir <targetDir>]\n",
          );
          return 1;
        }
        const validation = await validateTemplateFullSuite({
          templateId,
          targetRootDir: flags.dir,
        });
        process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
        return validation.ok ? 0 : 1;
      }

      process.stderr.write(
        "Usage:\n  tinytldr template new <template-id> [--kind static|carousel|video] [--dir <targetDir>]\n  tinytldr template validate <template-id>\n",
      );
      return 1;
    }

    default: {
      process.stdout.write(
        [
          `tinytldr v${getCliVersion()} — Deterministic social post, carousel, and video renderer`,
          ``,
          `Commands:`,
          `  tinytldr mcp                                                   Start MCP stdio server`,
          `  tinytldr serve [--port 8787] [--host 127.0.0.1]                Start HTTP MCP + REST render server`,
          `  tinytldr list [--kind static|carousel|video] [--tag <tag>]     List bundled templates`,
          `  tinytldr inspect <template-id>                                 Print full template manifest`,
          `  tinytldr validate --template <id> [--data <file.json>]         Dry-run schema & layout check`,
          `  tinytldr preview --template <id> [--data <file.json>] [--out]  Render 1x PNG preview`,
          `  tinytldr render --template <id> --out <path> [--size <preset>] Render final artifact`,
          `  tinytldr template new <template-id> [--kind static|video]      Scaffold a new MIT template`,
          `  tinytldr template validate <template-id>                       Validate sample + max-length across sizes`,
          `  tinytldr doctor                                                Verify Chromium, FFmpeg & fonts`,
        ].join("\n") + "\n",
      );
      return 0;
    }
  }
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectEntry) {
  runCli().then(
    (code) => {
      if (process.argv[2] !== "mcp" && process.argv[2] !== "serve") {
        process.exit(code);
      }
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    },
  );
}
