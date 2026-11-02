# ADR 0001: Video Rendering Engine Selection (HeyGen HyperFrames vs. Native WAAPI + FFmpeg Pipeline)

- **Status:** Accepted (Phase 0 Spike)
- **Date:** 2026-10-25
- **Owners:** `packages/renderer/`, `packages/runtime/`

## Context

Phase 0 requires rendering a 5-second CSS/WAAPI animation (1080×1080 @ 30 fps = 150 frames) to MP4 (`libx264`, `yuv420p`, `+faststart`) on Windows 11 in two ways and comparing determinism, speed, dependencies, and Windows support:

1. **(a) HeyGen HyperFrames (`@hyperframes/engine` / `@hyperframes/producer`):**
   - Confirm license, whether it can be called as a Node library, how its timeline convention works, and whether it requires GSAP.
2. **(b) `tinytldr` Native WAAPI + FFmpeg Pipeline (`WaapiFfmpegVideoEncoder`):**
   - Pause `document.getAnimations({ subtree: true })`, set `anim.currentTime = timestampMs` per frame via `window.__tinytldr.seek(ms)`, capture the frame in Playwright Chromium, and stream over `image2pipe` to an isolated `ffmpeg` child process.

---

## Evaluation of HeyGen HyperFrames (`heygen-com/hyperframes`)

We inspected `heygen-com/hyperframes` (`@hyperframes/core@0.8.198`, `@hyperframes/engine@0.8.198`, `@hyperframes/producer@0.8.198`):

- **License:** Apache-2.0 (permissive, compatible with `tinytldr`'s MIT policy).
- **Node Library Support:** Yes. `@hyperframes/engine` exports `createCaptureSession`, `initializeSession`, `captureFrameToBufferPipelined`, and `spawnStreamingEncoder`, and `@hyperframes/producer` exports `createRenderJob` and `executeRenderJob` (ESM, `node >= 22`).
- **Timeline Convention (`HfProtocol`):** Pages expose `window.__hf = { duration: number /* seconds */, seek(timeSeconds: number, options?: HfSeekOptions): void, media?: HfMediaElement[], transitions?: HfTransitionMeta[] }`.
- **GSAP Requirement:** **Not required.** While HyperFrames' default CLI scaffolds and showcase examples load GSAP from CDN and register `window.__timelines`, `@hyperframes/engine` itself has zero dependency on GSAP and works with any page implementing `window.__hf.seek(seconds)` (including CSS keyframes and WAAPI).
- **Architectural Trade-offs for `tinytldr`:**
  1. **Duplicate Browser Automation Stack:** `@hyperframes/engine` hard-depends on `puppeteer` and `puppeteer-core` (`^25.8.0`), plus `hono`, `@hono/node-server`, and `linkedom`. Because `tinytldr` already uses **Playwright Chromium** for static images (`png`, `jpg`, `webp`), `pdf`, and `tinytldr doctor`, pulling in `@hyperframes/engine` would force users and Docker images to install and maintain both Playwright and Puppeteer browser runtimes.
  2. **Unit & Sandbox Alignment:** `tinytldr`'s runtime contract (`window.__tinytldr = { ready, warnings, durationMs, seek(ms) }`) operates in integer/float milliseconds (`seek(ms)`) and runs inside Playwright's `page.route("**/*")` zero-network sandbox.

---

## Empirical Benchmark on Windows 11 (1080×1080, 5.0 s, 30 fps, 150 frames)

Both pipelines rendered a 5-second CSS/WAAPI spike card (4 concurrent keyframe animations: `badgeFadeIn`, `titleRise`, `bulletSlide`, `progressFill`) on Windows 11 (`Node v24.14.1`, `Playwright Chromium 156`, `FFmpeg 9.0.1`). The throwaway spike fixture and the HyperFrames-protocol encoder used for this comparison were removed after the decision; the shipped `WaapiFfmpegVideoEncoder` remains covered by the video-template tests:

| Criterion                    | (a) HyperFrames Protocol (`window.__hf` + CDP) | (b) `tinytldr` WAAPI Pipeline (`window.__tinytldr` + Playwright) |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Total Render Time (150f)** | `3,442 ms` (~43.6 fps effective)               | `3,446 ms` (~43.5 fps effective)                                 |
| **Frame Determinism**        | 100% identical SHA-256 hashes across runs      | 100% identical SHA-256 hashes across runs (`150/150` matched)    |
| **Unique Animated Frames**   | `150 / 150`                                    | `150 / 150`                                                      |
| **`ffprobe` Codec / Pixel**  | `h264` / `yuv420p` (TV range) + `faststart`    | `h264` / `yuv420p` (TV range) + `faststart`                      |
| **Windows 11 Support**       | Native pass                                    | Native pass                                                      |
| **Extra Dependencies**       | `puppeteer`, `hono`, `linkedom` (if imported)  | **Zero** (reuses existing `playwright` + `@tinytldr/runtime`)    |

---

## Decision

1. **Primary Video Engine:** Choose **Pipeline (b)** (`WaapiFfmpegVideoEncoder` behind the `VideoEncoder` interface in `@tinytldr/renderer`) as `tinytldr`'s video engine. It achieves identical speed (~3.44 s for a 5 s 1080p30 video) and 100% frame-hash determinism on Windows 11 while reusing the single Playwright Chromium browser instance and zero-network sandbox with zero extra dependencies.
2. **Protocol Compatibility:** `@tinytldr/runtime` also exposes `window.__hf = { duration, seek(seconds) }` as a lightweight 6-line alias delegating to `window.__tinytldr.seek(seconds * 1000)`, preserving compatibility with HyperFrames tooling at zero dependency cost.
3. **FFmpeg Color Range Normalization:** Because Chromium JPEG frame buffers use full-range YUV (`yuvj420p`), the FFmpeg filtergraph explicitly normalizes range (`scale=in_range=full:out_range=tv,format=yuv420p -color_range tv -pix_fmt yuv420p`) so every generated MP4 strictly reports `pix_fmt: yuv420p` across all players and `ffprobe` checks.
