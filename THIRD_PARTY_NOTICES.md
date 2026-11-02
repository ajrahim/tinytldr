# Third-Party Notices and Licenses

`tinytldr` is released under the [MIT License](LICENSE). All runtime dependencies in the production dependency tree are restricted to permissive open-source licenses (`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, and `OFL-1.1` for bundled fonts).

This file is verified and updated by `pnpm check:licenses` (`scripts/CheckLicenses.mjs`).

---

## External System Binaries (Invoked as Separate Processes)

### FFmpeg / FFprobe

- **Homepage:** https://ffmpeg.org
- **License:** GNU Lesser General Public License (LGPL) v2.1+ or GNU General Public License (GPL) v2+ (when compiled with `libx264`).
- **Usage in `tinytldr`:** `tinytldr` **never links** against FFmpeg libraries and does not bundle GPL code into its packages. When exporting `mp4`, `webm`, or `gif`, `@tinytldr/renderer` invokes the system `ffmpeg` and `ffprobe` binaries strictly as separate operating-system child processes over standard pipes (`stdin`/`stdout`). In the self-hosted Docker image, `ffmpeg` is installed from the upstream OS distribution package repository, where its full source code and build configuration are publicly available.

---

## Production & Workspace Dependencies

| Package                          | License    | Purpose                                                |
| -------------------------------- | ---------- | ------------------------------------------------------ |
| `zod`                            | MIT        | Authoritative schema validation and type generation    |
| `playwright` / `playwright-core` | Apache-2.0 | Deterministic headless Chromium rendering              |
| `liquidjs`                       | MIT        | Logic-safe HTML template compilation                   |
| `@modelcontextprotocol/sdk`      | MIT        | Official Model Context Protocol server/client SDK      |
| `react` / `react-dom`            | MIT        | Interactive storefront & sandboxed studio (`website/`) |
| `lucide-react`                   | ISC        | UI iconography (`website/`)                            |

---

## Bundled Fonts (`packages/templates/assets/fonts/`)

| Font Family      | License | License File                                             |
| ---------------- | ------- | -------------------------------------------------------- |
| `Inter`          | OFL-1.1 | `packages/templates/assets/fonts/inter/OFL.txt`          |
| `Fraunces`       | OFL-1.1 | `packages/templates/assets/fonts/fraunces/OFL.txt`       |
| `JetBrains Mono` | OFL-1.1 | `packages/templates/assets/fonts/jetbrains-mono/OFL.txt` |
| `Space Grotesk`  | OFL-1.1 | `packages/templates/assets/fonts/space-grotesk/OFL.txt`  |
