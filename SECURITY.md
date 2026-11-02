# Security Policy

## Untrusted HTML/CSS Rendering Sandbox

`tinytldr` compiles templates and agent-supplied design inputs (`strict`, `tweak`, and `freeform` modes) and renders them in headless Chromium. Because agent-supplied or third-party template markup and styles are treated as **untrusted input**, `tinytldr` enforces defense-in-depth isolation:

1. **No Template JavaScript:** Templates use LiquidJS syntax and HTML/CSS only. `<script>` tags, inline `on*` event handlers, `javascript:` URLs, and foreign script execution are stripped/rejected at validation and compilation time. Only the internal `@tinytldr/runtime` script is injected by the renderer.
2. **Zero External Network Access:** During Playwright Chromium rendering, all external network requests (`http://`, `https://`, `ws://`, `wss://`, `ftp://`, `file://`) are intercepted and aborted. Only explicitly registered local assets and bundled OFL fonts served via the internal local asset handler are permitted.
3. **Filesystem Path Containment:** Local asset registration (`add_asset`) and output paths validate canonical paths and reject directory traversal or unauthorized file reads.
4. **Resource & Time Bounds:** Every render session runs in an isolated browser context with strict per-page timeouts and frame limits, and `ffmpeg` is spawned with explicit argument arrays (`spawn`, never shell interpolation).

## Reporting a Vulnerability

Please **do not** report security vulnerabilities (especially sandbox escapes, SSRF/network bypasses, arbitrary file reads, or command injection) in public GitHub issues.

Instead, report vulnerabilities privately through [GitHub Security Advisories](https://github.com/ajrahim/tinytldr/security/advisories/new). Include:

- A minimal reproduction (`design.json`, template manifest/HTML/CSS, or MCP tool call payload).
- The affected package (`@tinytldr/core`, `@tinytldr/renderer`, `@tinytldr/mcp`, `tinytldr`, or `@tinytldr/website`) and operating system.
- The observable impact (e.g., outbound network request, file disclosure, script execution).

We will acknowledge receipt within 72 hours and coordinate a fix and advisory disclosure.
