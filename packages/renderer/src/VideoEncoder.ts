import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureEvenDimensions } from "@tinytldr/core";
import { getRuntimeScript } from "@tinytldr/runtime";
import { applyNetworkSandbox, type ChromiumRenderer } from "./ChromiumRenderer.js";

export interface VideoEncodeOptions {
  readonly html: string;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly fps?: number;
  readonly ffmpegBinary?: string;
  readonly signal?: AbortSignal;
}

export interface VideoEncodeResult {
  readonly outputPath: string;
  readonly fallbackPaths?: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly elapsedMs: number;
  readonly frameHashes: readonly string[];
  readonly warning?: string;
}

export interface VideoEncoder {
  readonly name: string;
  encodeMp4(options: VideoEncodeOptions): Promise<VideoEncodeResult>;
}

export interface FfprobeVideoMetadata {
  readonly codecName: string;
  readonly pixFmt: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly avgFrameRate: string;
  readonly nbFrames: number;
}

function pipeFramesToFfmpeg(options: {
  readonly outputPath: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly ffmpegBinary?: string;
  readonly signal?: AbortSignal;
}): {
  readonly writeFrame: (frameBuffer: Buffer) => Promise<void>;
  readonly finish: () => Promise<void>;
} {
  const args = [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-framerate",
    String(options.fps),
    "-i",
    "-",
    "-vf",
    `pad=${options.width}:${options.height}:0:0:black,scale=in_range=full:out_range=tv,format=yuv420p`,
    "-color_range",
    "tv",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    options.outputPath,
  ];

  const proc = spawn(options.ffmpegBinary ?? "ffmpeg", args, {
    stdio: ["pipe", "ignore", "pipe"],
    signal: options.signal,
  });

  let stderrText = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderrText += chunk.toString("utf8");
  });

  let spawnError: Error | null = null;
  proc.stdin.on("error", (err) => {
    if (!spawnError) {
      spawnError = err;
    }
  });

  const exitPromise = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => {
      spawnError = err;
    });
    proc.on("close", (code) => {
      if (spawnError) {
        reject(spawnError);
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${String(code)}: ${stderrText}`));
      }
    });
  });
  exitPromise.catch(() => {
    // Handled when writeFrame or finish awaits exitPromise
  });

  return {
    writeFrame(frameBuffer: Buffer): Promise<void> {
      if (spawnError) {
        return Promise.reject(spawnError);
      }
      return new Promise<void>((resolve, reject) => {
        const canContinue = proc.stdin.write(frameBuffer, (err) => {
          if (err || spawnError) {
            reject(err ?? spawnError ?? new Error("ffmpeg stdin write failed"));
          }
        });
        if (canContinue) {
          resolve();
        } else {
          proc.stdin.once("drain", resolve);
        }
      });
    },
    async finish(): Promise<void> {
      proc.stdin.end();
      await exitPromise;
    },
  };
}

/**
 * Pipeline (b): tinytldr's native WAAPI (`window.__tinytldr.seek(ms)`) + Playwright screenshot + ffmpeg pipe.
 */
export class WaapiFfmpegVideoEncoder implements VideoEncoder {
  public readonly name = "tinytldr-waapi-ffmpeg";
  private readonly renderer: ChromiumRenderer;

  public constructor(renderer: ChromiumRenderer) {
    this.renderer = renderer;
  }

  public async encodeMp4(options: VideoEncodeOptions): Promise<VideoEncodeResult> {
    options.signal?.throwIfAborted();
    const startTime = performance.now();
    const fps = options.fps ?? 30;
    const evenDims = ensureEvenDimensions(options.width, options.height);
    const frameCount = Math.max(1, Math.round((options.durationMs / 1000) * fps));

    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });

    const browser = await this.renderer.getBrowser();
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });

    const frameHashes: string[] = [];
    const capturedFrames: Buffer[] = [];

    try {
      const page = await context.newPage();
      await applyNetworkSandbox(page);
      await page.setContent(options.html, { waitUntil: "domcontentloaded" });
      if (!options.html.includes("window.__tinytldr")) {
        await page.addScriptTag({ content: getRuntimeScript(options.durationMs, options) });
      }

      await page.evaluate(async () => {
        const runtime = (globalThis as unknown as { __tinytldr: { ready: Promise<void> } })
          .__tinytldr;
        await runtime.ready;
      });

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        options.signal?.throwIfAborted();
        const timestampMs = (frameIndex * 1000) / fps;
        await page.evaluate((ms: number) => {
          const runtime = (
            globalThis as unknown as { __tinytldr: { seek(targetMs: number): void } }
          ).__tinytldr;
          runtime.seek(ms);
        }, timestampMs);

        const jpegBuffer = await page.screenshot({
          type: "jpeg",
          quality: 92,
          clip: { x: 0, y: 0, width: options.width, height: options.height },
        });

        frameHashes.push(crypto.createHash("sha256").update(jpegBuffer).digest("hex"));
        capturedFrames.push(jpegBuffer);
      }

      try {
        const ffmpegStream = pipeFramesToFfmpeg({
          outputPath: options.outputPath,
          fps,
          width: evenDims.width,
          height: evenDims.height,
          ffmpegBinary: options.ffmpegBinary,
          signal: options.signal,
        });
        try {
          for (const buf of capturedFrames) {
            await ffmpegStream.writeFrame(buf);
          }
        } finally {
          await ffmpegStream.finish();
        }
      } catch (err) {
        options.signal?.throwIfAborted();
        const dir = path.dirname(options.outputPath);
        const stem = path.basename(options.outputPath, path.extname(options.outputPath));
        const fallbackPaths: string[] = [];
        for (let i = 0; i < capturedFrames.length; i++) {
          const framePath = path.join(dir, `${stem}-frame-${String(i + 1).padStart(4, "0")}.jpg`);
          await fs.writeFile(framePath, capturedFrames[i]!);
          fallbackPaths.push(framePath);
        }
        const fallbackWarning = `[ffmpeg-fallback] ffmpeg unavailable (${err instanceof Error ? err.message : String(err)}); exported ${String(fallbackPaths.length)} JPEG frames instead.`;
        return {
          outputPath: fallbackPaths[0] ?? options.outputPath,
          fallbackPaths,
          width: evenDims.width,
          height: evenDims.height,
          fps,
          frameCount,
          durationMs: options.durationMs,
          elapsedMs: Math.round(performance.now() - startTime),
          frameHashes,
          warning: evenDims.warning ? `${evenDims.warning} ${fallbackWarning}` : fallbackWarning,
        };
      }

      return {
        outputPath: options.outputPath,
        width: evenDims.width,
        height: evenDims.height,
        fps,
        frameCount,
        durationMs: options.durationMs,
        elapsedMs: Math.round(performance.now() - startTime),
        frameHashes,
        warning: evenDims.warning,
      };
    } finally {
      await context.close();
    }
  }
}

export async function probeVideoFile(filePath: string): Promise<FfprobeVideoMetadata> {
  return new Promise<FfprobeVideoMetadata>((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,pix_fmt,width,height,avg_frame_rate,nb_frames,duration:format=duration",
      "-of",
      "json",
      filePath,
    ];

    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${String(code)}: ${stderr}`));
        return;
      }

      const parsed = JSON.parse(stdout) as {
        streams?: Array<{
          codec_name?: string;
          pix_fmt?: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
          nb_frames?: string;
          duration?: string;
        }>;
        format?: {
          duration?: string;
        };
      };

      const stream = parsed.streams?.[0];
      if (!stream) {
        reject(new Error("No video stream found in ffprobe output."));
        return;
      }

      const durationStr = stream.duration ?? parsed.format?.duration ?? "0";
      resolve({
        codecName: stream.codec_name ?? "",
        pixFmt: stream.pix_fmt ?? "",
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        durationSeconds: Number.parseFloat(durationStr),
        avgFrameRate: stream.avg_frame_rate ?? "",
        nbFrames: Number.parseInt(stream.nb_frames ?? "0", 10),
      });
    });
  });
}
