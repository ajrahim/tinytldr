import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { chromium, type Browser } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { ChromiumRenderer, WaapiFfmpegVideoEncoder } from "@tinytldr/renderer";
import { HostedRenderGate, HostedRequestScope } from "../src/HostedRequestScope.js";

const spawned = vi.hoisted(() => {
  const observer: { inspect?: (child: ChildProcess, options?: SpawnOptions) => void } = {};
  return observer;
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      spawned.inspect?.(child, args[2]);
      return child;
    },
  };
});

describe("Hosted request cancellation", () => {
  it("closes an in-flight Chromium launch and prevents reopening after abort", async () => {
    const controller = new AbortController();
    const renderer = new ChromiumRenderer(controller.signal);
    const original = chromium.launch.bind(chromium);
    let unblock!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let browser: Browser | undefined;
    const launch = vi.spyOn(chromium, "launch").mockImplementation(async (options) => {
      entered();
      await blocked;
      browser = await original(options);
      return browser;
    });
    try {
      const rendering = renderer.getBrowser();
      const rejected = expect(rendering).rejects.toThrow("Cancelled launch");
      await ready;
      controller.abort(new Error("Cancelled launch"));
      const closing = renderer.close();
      unblock();
      await rejected;
      await closing;
      expect(browser?.isConnected()).toBe(false);
      await expect(renderer.getBrowser()).rejects.toThrow("Cancelled launch");
      expect(launch).toHaveBeenCalledTimes(1);
    } finally {
      unblock();
      await renderer.close();
      launch.mockRestore();
    }
  });

  it("bounds concurrency, waits for tracked work and removes only the request directory", async () => {
    const gate = new HostedRenderGate();
    const scope = await HostedRequestScope.create(
      "fixture",
      {
        async upload() {},
        async signedUrl() {
          return "https://storage.test/fixture";
        },
        async delete() {},
      },
      gate,
      10,
    );
    const file = scope.artifacts.path("png");
    await fs.writeFile(file, "fixture");
    let finished = false;
    const operation = scope.run(async () => {
      await new Promise<void>((resolve) =>
        scope.controller.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      finished = true;
    });
    const cancelled = expect(operation).rejects.toThrow("time limit");
    expect(() => scope.run(async () => "unexpected")).toThrow("busy");
    await cancelled;
    await scope.close();
    expect(finished).toBe(true);
    await expect(fs.stat(path.dirname(file))).rejects.toMatchObject({ code: "ENOENT" });
    const release = gate.acquire();
    release();
    await expect(scope.renderer.getBrowser()).rejects.toThrow();
  });

  it("waits for an aborted live ffmpeg process without exporting fallback JPEGs", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-live-cancel-"));
    const controller = new AbortController();
    const renderer = new ChromiumRenderer();
    let child: ChildProcess | undefined;
    let exited = false;
    spawned.inspect = (process, options) => {
      if (options?.signal !== controller.signal) return;
      child = process;
      process.once("spawn", () => controller.abort(new Error("Cancelled running ffmpeg")));
      process.once("close", () => {
        exited = true;
      });
    };
    try {
      await expect(
        new WaapiFfmpegVideoEncoder(renderer).encodeMp4({
          html: "<!doctype html><body><p>Fixture</p>",
          width: 512,
          height: 512,
          fps: 12,
          durationMs: 500,
          outputPath: path.join(directory, "video.mp4"),
          signal: controller.signal,
        }),
      ).rejects.toThrow("Cancelled running ffmpeg");
      expect(child?.pid).toBeGreaterThan(0);
      expect(exited).toBe(true);
      expect((await fs.readdir(directory)).filter((file) => file.endsWith(".jpg"))).toEqual([]);
    } finally {
      spawned.inspect = undefined;
      await renderer.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("does not convert an aborted ffmpeg attempt into a JPEG fallback", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tinytldr-cancel-video-"));
    const renderer = new ChromiumRenderer();
    const controller = new AbortController();
    const browser = await renderer.getBrowser();
    const original = browser.newContext.bind(browser);
    const newContext = vi.spyOn(browser, "newContext").mockImplementation(async (options) => {
      const context = await original(options);
      const newPage = context.newPage.bind(context);
      vi.spyOn(context, "newPage").mockImplementation(async () => {
        const page = await newPage();
        const screenshot = page.screenshot.bind(page);
        vi.spyOn(page, "screenshot").mockImplementation(async (options) => {
          const result = await screenshot(options);
          controller.abort(new Error("Cancelled encoding"));
          return result;
        });
        return page;
      });
      return context;
    });
    try {
      await expect(
        new WaapiFfmpegVideoEncoder(renderer).encodeMp4({
          html: "<!doctype html><body><p>Fixture</p>",
          width: 128,
          height: 128,
          fps: 12,
          durationMs: 1,
          ffmpegBinary: "unavailable-fixture-ffmpeg",
          outputPath: path.join(directory, "video.mp4"),
          signal: controller.signal,
        }),
      ).rejects.toThrow("Cancelled encoding");
      expect(await fs.readdir(directory)).toEqual([]);
    } finally {
      newContext.mockRestore();
      await renderer.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
