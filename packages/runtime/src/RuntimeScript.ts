export interface TinytldrRuntimeWarning {
  readonly code: "overflow" | "clipping" | "safe_zone" | "contrast" | "missing-image";
  readonly message: string;
  readonly selector?: string;
}

export interface TinytldrWindowApi {
  readonly ready: Promise<void>;
  readonly warnings: TinytldrRuntimeWarning[];
  readonly durationMs: number;
  readonly slideCount: number;
  seek(ms: number): void;
}

/**
 * Returns the self-contained browser runtime script injected into every rendered page.
 * Exposes `window.__tinytldr = { ready, warnings, durationMs, seek(ms) }` and
 * `window.__hf = { duration, seek(seconds) }` for protocol compatibility.
 */
export function getRuntimeScript(
  defaultDurationMs = 5000,
  canvasSize?: { readonly width: number; readonly height: number },
): string {
  if (
    canvasSize &&
    (!Number.isFinite(canvasSize.width) ||
      canvasSize.width <= 0 ||
      !Number.isFinite(canvasSize.height) ||
      canvasSize.height <= 0)
  ) {
    throw new Error("Runtime canvas dimensions must be finite, positive numbers.");
  }
  return `(function () {
  const warnings = [];
  let durationMs = ${Number(defaultDurationMs)};
  // Embedded viewport metrics can lag newly mounted offscreen frames.
  const canvasWidth = ${canvasSize?.width ?? "null"};
  const canvasHeight = ${canvasSize?.height ?? "null"};

  function getAnimationsSafe() {
    if (typeof document.getAnimations !== "function") {
      return [];
    }
    return document.getAnimations({ subtree: true });
  }

  function computeDurationMs() {
    const animations = getAnimationsSafe();
    let maxEndMs = 0;
    for (const anim of animations) {
      if (anim.effect && typeof anim.effect.getComputedTiming === "function") {
        const timing = anim.effect.getComputedTiming();
        const endTime = Number(timing.endTime || 0);
        if (Number.isFinite(endTime) && endTime > maxEndMs) {
          maxEndMs = endTime;
        }
      }
    }
    return maxEndMs > 0 ? maxEndMs : durationMs;
  }

  function updateDeclarativeCounters(targetMs) {
    const counters = Array.from(document.querySelectorAll("[data-tt-counter-to]"));
    for (const el of counters) {
      const rawTarget = String(el.getAttribute("data-tt-counter-to") || "");
      const delayMs = Number(el.getAttribute("data-tt-counter-delay") || 200);
      const durMs = Math.max(100, Number(el.getAttribute("data-tt-counter-duration") || 2200));
      const match = rawTarget.match(/^([^0-9]*?)([0-9][0-9,]*(?:\\.[0-9]+)?)(.*)$/);
      if (!match) {
        el.textContent = rawTarget;
        continue;
      }
      const prefix = match[1] || "";
      const numStr = match[2] || "0";
      const suffix = match[3] || "";
      const hasCommas = numStr.includes(",");
      const dotIdx = numStr.indexOf(".");
      const decimals = dotIdx >= 0 ? numStr.length - dotIdx - 1 : 0;
      const endVal = parseFloat(numStr.replace(/,/g, "")) || 0;
      const rawT = (targetMs - delayMs) / durMs;
      const clampedT = Math.max(0, Math.min(1, rawT));
      const easedT = 1 - Math.pow(1 - clampedT, 3);
      const curVal = endVal * easedT;
      let formatted = curVal.toFixed(decimals);
      if (hasCommas) {
        const parts = formatted.split(".");
        parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
        formatted = parts.join(".");
      }
      el.textContent = prefix + formatted + suffix;
    }
  }

  function seek(ms) {
    const targetMs = Math.max(0, Number(ms) || 0);
    const animations = getAnimationsSafe();
    for (const anim of animations) {
      try {
        anim.pause();
        anim.currentTime = targetMs;
      } catch (_err) {
        // Ignore animations that cannot be seeked
      }
    }
    updateDeclarativeCounters(targetMs);
    if (typeof window.__tinytldrOnSeek === "function") {
      window.__tinytldrOnSeek(targetMs);
    }
  }

  async function waitForAssets() {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    const images = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      images.map((img) => {
        if (img.complete) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      })
    );
  }

  function runAutofit() {
    const elements = Array.from(document.querySelectorAll("[data-tt-autofit]"));
    for (const el of elements) {
      const minPx = Math.max(8, Number(el.getAttribute("data-tt-min-font-px") || 20));
      const maxPx = Math.max(minPx, Number(el.getAttribute("data-tt-max-font-px") || 64));
      const maxLines = Math.max(0, Number(el.getAttribute("data-tt-max-lines") || 0));

      let low = minPx;
      let high = maxPx;
      let best = minPx;

      for (let iter = 0; iter < 12; iter++) {
        const mid = (low + high) / 2;
        el.style.fontSize = mid.toFixed(2) + "px";
        const computed = window.getComputedStyle(el);
        const lineHeight = parseFloat(computed.lineHeight) || mid * 1.3;
        const estimatedLines = lineHeight > 0 ? el.scrollHeight / lineHeight : 1;
        const clips =
          computed.overflowX !== "visible" || computed.overflowY !== "visible";
        const fitsContainer =
          !clips ||
          (el.scrollWidth <= el.clientWidth + 2 &&
            el.scrollHeight <= el.clientHeight + 2);
        const fitsLines = maxLines === 0 || estimatedLines <= maxLines + 0.35;

        if (fitsContainer && fitsLines) {
          best = mid;
          low = mid;
        } else {
          high = mid;
        }
      }

      el.style.fontSize = Math.floor(best * 2) / 2 + "px";

      if (maxLines > 0) {
        const computed = window.getComputedStyle(el);
        const lineHeight = parseFloat(computed.lineHeight) || minPx * 1.3;
        const estimatedLines = lineHeight > 0 ? el.scrollHeight / lineHeight : 1;
        if (estimatedLines > maxLines + 0.45) {
          const slotName = el.getAttribute("data-tt-slot") || "autofit";
          warnings.push({
            code: "overflow",
            message:
              "Slot '" +
              slotName +
              "' exceeds maxLines (" +
              maxLines +
              ") even at minimum font size (" +
              minPx +
              "px).",
            selector: "[data-tt-slot=\\"" + slotName + "\\"]",
          });
        }
      }
    }
  }

  function detectOverflowWarnings() {
    const slots = Array.from(document.querySelectorAll("[data-tt-slot]"));
    const viewportW = canvasWidth ?? (window.innerWidth || document.documentElement.clientWidth);
    const viewportH = canvasHeight ?? (window.innerHeight || document.documentElement.clientHeight);

    for (const el of slots) {
      const slotName = el.getAttribute("data-tt-slot") || "unknown";
      const selector = "[data-tt-slot=\\"" + slotName + "\\"]";
      if (warnings.some((w) => w.code === "overflow" && w.selector === selector)) {
        continue;
      }
      const style = window.getComputedStyle(el);
      const clipsContent =
        style.overflowX !== "visible" || style.overflowY !== "visible";
      const hasClippedOverflow =
        clipsContent &&
        (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);

      const rect = el.getBoundingClientRect();
      const slideEl = el.closest(".tt-slide");
      const boundsRect = slideEl
        ? slideEl.getBoundingClientRect()
        : { left: 0, top: 0, right: viewportW, bottom: viewportH };

      const exceedsViewport =
        rect.right > boundsRect.right + 2 ||
        rect.bottom > boundsRect.bottom + 2 ||
        rect.left < boundsRect.left - 2 ||
        rect.top < boundsRect.top - 2;

      if (hasClippedOverflow || exceedsViewport) {
        warnings.push({
          code: "overflow",
          message: "Slot '" + slotName + "' overflows its container.",
          selector,
        });
      }
    }
  }

  function detectSafeZoneWarnings() {
    const safeTop = Number(document.body.getAttribute("data-tt-safe-top") || 0);
    const safeBottom = Number(document.body.getAttribute("data-tt-safe-bottom") || 0);
    if (safeTop <= 0 && safeBottom <= 0) return;

    const viewportH = canvasHeight ?? (window.innerHeight || document.documentElement.clientHeight);
    const slots = Array.from(document.querySelectorAll("[data-tt-slot]"));

    for (const el of slots) {
      const slotName = el.getAttribute("data-tt-slot") || "unknown";
      const selector = "[data-tt-slot=\\"" + slotName + "\\"]";
      if (warnings.some((w) => w.code === "safe_zone" && w.selector === selector)) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const slideEl = el.closest(".tt-slide");
      const containerTop = slideEl ? slideEl.getBoundingClientRect().top : 0;
      const containerHeight = slideEl
        ? slideEl.getBoundingClientRect().height
        : viewportH;

      const relTop = rect.top - containerTop;
      const relBottom = rect.bottom - containerTop;

      if (
        (safeTop > 0 && relTop < safeTop - 2) ||
        (safeBottom > 0 && relBottom > containerHeight - safeBottom + 2)
      ) {
        warnings.push({
          code: "safe_zone",
          message:
            "Slot '" +
            slotName +
            "' intrudes into the platform UI safe zone (top " +
            safeTop +
            "px, bottom " +
            safeBottom +
            "px).",
          selector,
        });
      }
    }
  }

  function parseRgb(colorStr) {
    if (!colorStr) return null;
    const match = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!match) return null;
    const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
    if (alpha < 0.15) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function relativeLuminance(rgb) {
    const channels = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function findEffectiveBgRgb(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const style = window.getComputedStyle(cur);
      const rgb = parseRgb(style.backgroundColor);
      if (rgb) return rgb;
      cur = cur.parentElement;
    }
    const bodyRgb = parseRgb(window.getComputedStyle(document.body).backgroundColor);
    return bodyRgb || [11, 15, 25];
  }

  function detectContrastWarnings() {
    const slots = Array.from(document.querySelectorAll("[data-tt-slot]"));
    for (const el of slots) {
      if (!(el.textContent || "").trim()) continue;
      const style = window.getComputedStyle(el);
      if (parseFloat(style.opacity || "1") < 0.85) continue;
      const fg = parseRgb(style.color);
      const bg = findEffectiveBgRgb(el);
      if (!fg || !bg) continue;
      const lum1 = relativeLuminance(fg);
      const lum2 = relativeLuminance(bg);
      const ratio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
      const fontSize = parseFloat(style.fontSize) || 16;
      const fontWeight = parseInt(style.fontWeight, 10) || 400;
      const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minRatio = isLargeText ? 3.0 : 4.5;
      if (ratio < minRatio) {
        const slotName = el.getAttribute("data-tt-slot") || "unknown";
        warnings.push({
          code: "contrast",
          message:
            "Slot '" +
            slotName +
            "' contrast ratio (" +
            ratio.toFixed(2) +
            ":1) is below WCAG AA threshold (" +
            minRatio +
            ":1).",
          selector: "[data-tt-slot=\\"" + slotName + "\\"]",
        });
      }
    }
  }

  function detectMissingImageWarnings() {
    const images = Array.from(document.querySelectorAll("img"));
    for (const img of images) {
      if (!img.complete || img.naturalWidth === 0) {
        const slotName = img.getAttribute("data-tt-slot") || img.getAttribute("alt") || "image";
        warnings.push({
          code: "missing-image",
          message: "Image '" + slotName + "' failed to load.",
          selector: "img",
        });
      }
    }
  }

  const api = {
    ready: Promise.resolve(),
    warnings,
    durationMs,
    slideCount: 1,
    seek,
  };

  const hfApi = {
    duration: durationMs / 1000,
    seek(seconds) {
      seek((Number(seconds) || 0) * 1000);
    },
  };

  api.ready = (async () => {
    await waitForAssets();
    durationMs = computeDurationMs();
    const slides = document.querySelectorAll(".tt-slide");
    api.slideCount = slides.length > 0 ? slides.length : 1;
    const isVideo = document.body && document.body.getAttribute("data-tt-kind") === "video";
    seek(isVideo ? durationMs : 0);
    runAutofit();
    detectOverflowWarnings();
    detectSafeZoneWarnings();
    detectContrastWarnings();
    detectMissingImageWarnings();
    if (isVideo) {
      seek(0);
    }
    api.durationMs = durationMs;
    hfApi.duration = durationMs / 1000;
  })();

  window.__tinytldr = api;
  window.__hf = hfApi;
})();`;
}
