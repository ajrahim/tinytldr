# Spec 003 — Phase 3: Video Engine (`mp4`) & Animated Templates

- **Status:** Active (Approved by User)
- **Phase:** Phase 3
- **Packages:** `@tinytldr/runtime`, `@tinytldr/templates`, `@tinytldr/renderer`

## 1. Objective

Deliver the production video rendering pipeline and the 3 launch animated video templates (`kinetic-quote`, `timeline-reveal`, `stat-counter`):

1. **Deterministic WAAPI + CSS Keyframes + Counter Stepping (`@tinytldr/runtime`)**:
   - Pause all `document.getAnimations({ subtree: true })` timelines and step `currentTime = ms` deterministically.
   - Support declarative numeric counter interpolation via `data-tt-counter-to`, `data-tt-counter-duration`, and `data-tt-counter-delay` so templates remain 100% declarative HTML + CSS without inline scripts.
   - Perform layout/overflow/contrast checks at the settled end state (`durationMs`) before seeking to the target frame timestamp.
2. **H.264 MP4 Encoding & Fallback (`@tinytldr/renderer`)**:
   - Encode 30fps (or template-configured `fps`) PNG frame streams via `ffmpeg-static` (`-c:v libx264 -pix_fmt yuv420p -movflags +faststart -r <fps>`).
   - Provide clean fallback to a numbered PNG frame sequence with an explicit warning if `ffmpeg` is unavailable.
3. **Animated Video Templates (`@tinytldr/templates`)**:
   - `kinetic-quote`: Staggered word/line entrance, animated accent highlight bar, and author reveal (`durationMs: 4000`, `fps: 30`).
   - `timeline-reveal`: Sequential milestone/changelog reveal with animated progress rail and node badges (`durationMs: 5000`, `fps: 30`).
   - `stat-counter`: Smooth cubic-out numeric counter climb (`0 -> target`), animated progress bar, and context reveal (`durationMs: 4000`, `fps: 30`).

## 2. Verification Gate

- Render all 3 video templates to `.mp4` and verify via `ffprobe`:
  - `codec_name === "h264"`
  - `pix_fmt === "yuv420p"`
  - `r_frame_rate === "30/1"`
  - Duration matches spec (`4.0s` / `5.0s`) within `±1` frame.
- Verify 100% SHA-256 frame-hash determinism across two independent runs.
- Commit golden PNGs (`samples/golden-square.png`) for all 3 video templates and pass `pnpm check`.
