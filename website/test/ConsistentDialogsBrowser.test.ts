import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { hasFirebaseEmulators, startWorkspaceTestServer } from "./WorkspaceServerFixture.js";
import { expectDialogLayout } from "./DialogBrowserFixture.js";

describe.skipIf(!hasFirebaseEmulators)("Consistent modal presentation and lifecycle", () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof startWorkspaceTestServer>>;
  beforeAll(async () => {
    site = await startWorkspaceTestServer();
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  async function sidebarAction(page: Page, name: RegExp | string) {
    if (page.viewportSize()!.width <= 900) {
      const toggle = page.getByRole("button", { name: "Open sidebar", exact: true });
      await toggle.waitFor();
      await toggle.click();
    }
    await page.getByRole("button", { name }).click();
  }

  it("introduces templates for agents with upright motion, branding and one centered action", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(site.baseUrl);
      const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
      await welcome.waitFor();
      expect(await welcome.locator(".welcome-artwork").getAttribute("aria-hidden")).toBe("true");
      expect(await welcome.locator(".welcome-artwork.is-templates").count()).toBe(1);
      expect(await welcome.locator(".welcome-agent, .welcome-slots, .welcome-post").count()).toBe(
        3,
      );
      expect(await welcome.locator(".welcome-art-arrow").count()).toBe(2);
      expect(await welcome.locator(".welcome-artwork").innerText()).toContain("Less, but better.");
      expect(await welcome.locator("img,video,iframe").count()).toBe(0);
      expect(
        await welcome
          .getByRole("heading", { name: "Templates built for agents.", exact: true })
          .count(),
      ).toBe(1);
      expect(await welcome.locator(".app-dialog-title").innerText()).toBe("tinytldr.");
      expect(await welcome.locator(".app-dialog-footer .primary-button").count()).toBe(1);
      expect(await welcome.getByRole("button", { name: "Connect an agent" }).count()).toBe(0);
      expect(await welcome.locator(".primary-button").innerText()).toBe("Start Creating");
      expect(await welcome.locator(".primary-button svg, .primary-button span").count()).toBe(0);
      expect(
        await welcome
          .getByRole("button", { name: "Start Creating" })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await welcome.evaluate((element) => ({
        animations: element.getAnimations({ subtree: true }).length,
        pieces: Array.from(element.querySelectorAll(".welcome-piece"), (piece) => ({
          transform: getComputedStyle(piece).transform,
          opacity: getComputedStyle(piece).opacity,
        })),
      }));
      expect(reduced.animations).toBe(0);
      expect(reduced.pieces).toEqual(
        Array.from({ length: 5 }, () => ({ transform: "none", opacity: "1" })),
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const motion = await welcome.evaluate((element) => {
        const card = element.querySelector(".welcome-agent")!;
        const animation = card.getAnimations()[0];
        animation.pause();
        animation.currentTime = 0;
        const beginning = {
          opacity: getComputedStyle(card).opacity,
          transform: new DOMMatrix(getComputedStyle(card).transform),
        };
        animation.currentTime = 700;
        const end = {
          opacity: getComputedStyle(card).opacity,
          transform: new DOMMatrix(getComputedStyle(card).transform),
        };
        return {
          beginningOpacity: beginning.opacity,
          endOpacity: end.opacity,
          beginningY: beginning.transform.f,
          endY: end.transform.f,
          rotation: [
            beginning.transform.b,
            beginning.transform.c,
            end.transform.b,
            end.transform.c,
          ],
          delays: Array.from(
            element.querySelectorAll(".welcome-piece"),
            (item) => getComputedStyle(item).animationDelay,
          ),
        };
      });
      expect(motion.beginningOpacity).toBe("0");
      expect(motion.endOpacity).toBe("1");
      expect(motion.beginningY).toBe(14);
      expect(motion.endY).toBe(0);
      expect(motion.rotation).toEqual([0, 0, 0, 0]);
      expect(motion.delays).toEqual(["0s", "0.08s", "0.16s", "0.24s", "0.32s"]);
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 640, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["light", "dark"]) {
          await page.evaluate((name) => {
            document.documentElement.classList.remove("light", "dark");
            document.documentElement.classList.add(name);
          }, theme);
          await expectDialogLayout(welcome, viewport);
          const layout = await welcome.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const artwork = element.querySelector(".welcome-artwork")!.getBoundingClientRect();
            const headline = element.querySelector(".welcome-headline")!;
            const heading = headline.getBoundingClientRect();
            const close = element.querySelector(".dialog-close")!.getBoundingClientRect();
            const start = element.querySelector(".primary-button")!.getBoundingClientRect();
            const brand = element.querySelector(".app-dialog-title")!.getBoundingClientRect();
            const body = element.querySelector(".app-dialog-body")!;
            return {
              artworkOffset: (artwork.left + artwork.right - rect.left - rect.right) / 2,
              artworkHeight: artwork.height,
              headingOffset: (heading.left + heading.right - rect.left - rect.right) / 2,
              headlineVisible:
                heading.top >= body.getBoundingClientRect().top &&
                heading.bottom <= body.getBoundingClientRect().bottom,
              headlineSize: getComputedStyle(headline).fontSize,
              headerBorder: getComputedStyle(element.querySelector(".app-dialog-header")!)
                .borderBottomWidth,
              footerBorder: getComputedStyle(element.querySelector(".app-dialog-footer")!)
                .borderTopWidth,
              closeVisible: close.top >= rect.top && close.bottom <= rect.bottom,
              startVisible: start.top >= rect.top && start.bottom <= rect.bottom,
              startWidth: start.width,
              startOffset: (start.left + start.right - rect.left - rect.right) / 2,
              startAlignment: getComputedStyle(element.querySelector(".primary-button")!)
                .justifyContent,
              brandLeft: brand.left - rect.left,
              brandVisible: brand.top >= rect.top && brand.bottom <= close.bottom,
              cardRotation: Array.from(element.querySelectorAll(".welcome-piece"), (piece) => {
                const matrix = new DOMMatrix(getComputedStyle(piece).transform);
                return [matrix.b, matrix.c];
              }),
              scrollable: body.scrollHeight > body.clientHeight,
            };
          });
          if (viewport.height <= 420) {
            expect(layout.artworkHeight).toBe(0);
            expect(layout.headlineVisible).toBe(true);
          } else {
            expect(Math.abs(layout.artworkOffset)).toBeLessThanOrEqual(1);
            expect(layout.artworkHeight).toBeGreaterThan(0);
          }
          expect(Math.abs(layout.headingOffset)).toBeLessThanOrEqual(1);
          expect(layout.headlineSize).toBe(
            viewport.height <= 420 ? "24px" : viewport.width <= 420 ? "28px" : "36px",
          );
          expect(layout.headerBorder).toBe("0px");
          expect(layout.footerBorder).toBe("0px");
          expect(layout.closeVisible).toBe(true);
          expect(layout.startVisible).toBe(true);
          expect(layout.startWidth).toBeGreaterThanOrEqual(176);
          expect(Math.abs(layout.startOffset)).toBeLessThanOrEqual(1);
          expect(layout.startAlignment).toBe("center");
          expect(Math.abs(layout.brandLeft - 21)).toBeLessThanOrEqual(1);
          expect(layout.brandVisible).toBe(true);
          expect(layout.cardRotation).toEqual(Array.from({ length: 5 }, () => [0, 0]));
          if (layout.scrollable) {
            const body = welcome.locator(".app-dialog-body");
            await body.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            expect(
              await body.evaluate(
                (element) =>
                  element.querySelector(".welcome-description")!.getBoundingClientRect().bottom <=
                  element.getBoundingClientRect().bottom + 1,
              ),
            ).toBe(true);
            await body.evaluate((element) => {
              element.scrollTop = 0;
            });
          }
        }
      }
      await welcome.getByRole("button", { name: "Start Creating", exact: true }).click();
      await sidebarAction(page, "Connect an Agent");
      const agent = page.getByRole("dialog", { name: "Bring your agent." });
      await agent.waitFor();
      expect(await agent.getAttribute("class")).not.toContain("is-welcome");
      await expectDialogLayout(agent, page.viewportSize()!);
    } finally {
      await context.close();
    }
  });

  it("browses all welcome topics with modal-centered edge arrows and retained drafts", async () => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const slides = [
      {
        id: "templates",
        label: "Templates",
        title: "Templates built for agents.",
        description: "Your agent brings the words. Our templates take care of the visuals.",
        artText: "Template",
        pieces: 5,
      },
      {
        id: "consistency",
        label: "Consistency",
        title: "Made to be consistent",
        description: "Reuse layouts, colors, and typography to keep every page on brand.",
        artText: "Shared style",
        pieces: 4,
      },
      {
        id: "byok",
        label: "Your key",
        title: "Bring your own key",
        description: "Use your own key for optional AI drafting. Templates work without it.",
        artText: "No key needed.",
        pieces: 2,
      },
    ];
    try {
      await page.goto(site.baseUrl);
      const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
      await welcome.waitFor();
      const previewHeading = page.frameLocator('iframe[title="Design preview"]').locator("h1");
      await previewHeading.waitFor();
      await previewHeading.evaluate((element) => {
        element.dataset.carouselProbe = "preserved";
      });
      const originalTitle = await previewHeading.innerText();
      await page.clock.install();
      await page.clock.fastForward(60_000);
      expect(
        await welcome.getByRole("group", { name: "1 of 3: Templates", exact: true }).count(),
      ).toBe(1);
      const previous = welcome.getByRole("button", { name: "Previous slide", exact: true });
      await previous.focus();
      await page.keyboard.press("Enter");
      expect(
        await welcome.getByRole("group", { name: "3 of 3: Your key", exact: true }).count(),
      ).toBe(1);
      expect(await previous.evaluate((element) => element === document.activeElement)).toBe(true);
      const next = welcome.getByRole("button", { name: "Next slide", exact: true });
      await next.focus();
      await page.keyboard.press("Space");
      expect(
        await welcome.getByRole("group", { name: "1 of 3: Templates", exact: true }).count(),
      ).toBe(1);
      expect(await next.evaluate((element) => element === document.activeElement)).toBe(true);
      for (const label of ["2 of 3: Consistency", "3 of 3: Your key", "1 of 3: Templates"]) {
        await next.click();
        expect(await welcome.getByRole("group", { name: label, exact: true }).count()).toBe(1);
      }
      for (const label of ["3 of 3: Your key", "2 of 3: Consistency", "1 of 3: Templates"]) {
        await previous.click();
        expect(await welcome.getByRole("group", { name: label, exact: true }).count()).toBe(1);
      }
      expect(
        await welcome
          .getByRole("region", { name: "About tinytldr" })
          .getAttribute("aria-roledescription"),
      ).toBe("carousel");
      expect(await welcome.locator(".welcome-copy").getAttribute("aria-live")).toBe("polite");
      expect(await welcome.locator(".welcome-copy").getAttribute("aria-atomic")).toBe("true");
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 640, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["light", "dark"]) {
          await page.evaluate((name) => {
            document.documentElement.classList.remove("light", "dark");
            document.documentElement.classList.add(name);
          }, theme);
          for (const [index, slide] of slides.entries()) {
            expect(await welcome.getByRole("group", { name: "Choose a topic" }).count()).toBe(0);
            expect(
              await welcome
                .getByRole("button", { name: /^(Templates|Consistency|Your key)$/ })
                .count(),
            ).toBe(0);
            expect(
              await welcome
                .getByRole("group", { name: `${index + 1} of 3: ${slide.label}`, exact: true })
                .count(),
            ).toBe(1);
            expect(await welcome.locator(".welcome-hero").count()).toBe(1);
            expect(
              await welcome.getByRole("heading", { name: slide.title, exact: true }).count(),
            ).toBe(1);
            expect(await welcome.locator(".welcome-description").innerText()).toBe(
              slide.description,
            );
            expect(await welcome.locator(".welcome-artwork").getAttribute("class")).toContain(
              `is-${slide.id}`,
            );
            await welcome.locator(".app-dialog-body").evaluate((element) => {
              element.scrollTop = 0;
            });
            await expectDialogLayout(welcome, viewport);
            const layout = await welcome.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const button = element.querySelector(".primary-button")!.getBoundingClientRect();
              const note = element.querySelector(".welcome-draft-note")!;
              const noteRect = note.getBoundingClientRect();
              const arrows = Array.from(
                element.querySelectorAll(".welcome-carousel-arrow"),
                (arrow) => arrow.getBoundingClientRect(),
              );
              const content = Array.from(
                element.querySelectorAll(
                  ".welcome-artwork, .welcome-copy, .primary-button, .welcome-draft-note",
                ),
              )
                .map((item) => item.getBoundingClientRect())
                .filter((bounds) => bounds.width > 0 && bounds.height > 0);
              const artwork = element.querySelector(".welcome-artwork")!.getBoundingClientRect();
              const pieces = Array.from(
                element.querySelectorAll(".welcome-art-stage > .welcome-piece"),
                (piece) => piece.getBoundingClientRect(),
              );
              const piecesTop = Math.min(...pieces.map((piece) => piece.top));
              const piecesBottom = Math.max(...pieces.map((piece) => piece.bottom));
              return {
                noteInFooter: note.parentElement?.classList.contains("app-dialog-footer"),
                controlsVisible: Array.from(
                  element.querySelectorAll(".welcome-carousel-controls button"),
                ).every((control) => {
                  const bounds = control.getBoundingClientRect();
                  return (
                    bounds.left >= rect.left &&
                    bounds.right <= rect.right &&
                    bounds.top >= rect.top &&
                    bounds.bottom <= rect.bottom
                  );
                }),
                noteTop: noteRect.top,
                noteBottom: noteRect.bottom,
                buttonBottom: button.bottom,
                dialogBottom: rect.bottom,
                artworkVisible: artwork.height > 0,
                descriptionVisible:
                  element.querySelector(".welcome-description")!.getBoundingClientRect().bottom <=
                  element.querySelector(".app-dialog-body")!.getBoundingClientRect().bottom + 1,
                arrowCenterOffsets: arrows.map(
                  (arrow) => (arrow.top + arrow.bottom - rect.top - rect.bottom) / 2,
                ),
                leftArrowInset: arrows[0].left - rect.left,
                rightArrowInset: rect.right - arrows[1].right,
                clearGutters: content.every(
                  (bounds) => bounds.left >= arrows[0].right && bounds.right <= arrows[1].left,
                ),
                piecesInside: pieces.every(
                  (piece) =>
                    piece.left >= artwork.left - 1 &&
                    piece.right <= artwork.right + 1 &&
                    piece.top >= artwork.top - 1 &&
                    piece.bottom <= artwork.bottom + 1,
                ),
                piecesCenterOffset: (piecesTop + piecesBottom - artwork.top - artwork.bottom) / 2,
                clipped: Array.from(
                  element.querySelectorAll(
                    ".welcome-card, .welcome-style-strip, .welcome-key-value",
                  ),
                ).filter(
                  (item) =>
                    item.scrollWidth > item.clientWidth + 1 ||
                    item.scrollHeight > item.clientHeight + 1,
                ).length,
                rotations: Array.from(element.querySelectorAll(".welcome-piece"), (piece) => {
                  const matrix = new DOMMatrix(getComputedStyle(piece).transform);
                  return [matrix.b, matrix.c];
                }),
                artText: element.querySelector(".welcome-artwork")!.textContent,
                animations: element.getAnimations({ subtree: true }).length,
              };
            });
            expect(layout.noteInFooter).toBe(true);
            expect(layout.controlsVisible).toBe(true);
            expect(layout.arrowCenterOffsets.every((offset) => Math.abs(offset) <= 1)).toBe(true);
            expect(Math.abs(layout.leftArrowInset - 13)).toBeLessThanOrEqual(1);
            expect(Math.abs(layout.rightArrowInset - 13)).toBeLessThanOrEqual(1);
            expect(layout.clearGutters).toBe(true);
            expect(layout.noteTop - layout.buttonBottom).toBeGreaterThanOrEqual(11);
            expect(layout.noteBottom).toBeLessThanOrEqual(layout.dialogBottom + 1);
            expect(layout.animations).toBe(0);
            if (viewport.height <= 420) expect(layout.descriptionVisible).toBe(true);
            if (layout.artworkVisible) {
              expect(layout.piecesInside).toBe(true);
              expect(Math.abs(layout.piecesCenterOffset)).toBeLessThanOrEqual(1);
              expect(layout.clipped).toBe(0);
              expect(layout.rotations.every(([b, c]) => b === 0 && c === 0)).toBe(true);
              expect(layout.artText).toContain(slide.artText);
              expect(await welcome.locator(".welcome-art-stage > .welcome-piece").count()).toBe(
                slide.pieces,
              );
            }
            expect(await previewHeading.getAttribute("data-carousel-probe")).toBe("preserved");
            await next.click();
            expect(await next.evaluate((element) => element === document.activeElement)).toBe(true);
          }
        }
      }
      await welcome.getByRole("button", { name: "Start Creating", exact: true }).click();
      expect(await previewHeading.innerText()).toBe(originalTitle);
      expect(await page.evaluate(() => localStorage.getItem("tinytldr:welcome:v1"))).toBe("seen");
      const opener = page.getByRole("button", { name: "Welcome", exact: true });
      await opener.click();
      await welcome.waitFor();
      expect(
        await welcome.getByRole("group", { name: "1 of 3: Templates", exact: true }).count(),
      ).toBe(1);
      await page.keyboard.press("Escape");
      expect(await opener.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await previewHeading.getAttribute("data-carousel-probe")).toBe("preserved");
    } finally {
      await context.close();
    }
  });

  it("keeps both modal-edge arrows fixed while a short portrait slide scrolls", async () => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 360 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(site.baseUrl);
      const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
      await welcome.waitFor();
      const body = welcome.locator(".app-dialog-body");
      expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      );
      const arrows = welcome.locator(".welcome-carousel-arrow");
      const before = await arrows.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().y),
      );
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const after = await arrows.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().y),
      );
      expect(after).toEqual(before);
      await welcome.getByRole("button", { name: "Next slide", exact: true }).click();
      expect(
        await welcome.getByRole("group", { name: "2 of 3: Consistency", exact: true }).count(),
      ).toBe(1);
      expect(
        await arrows.evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).position === "absolute"),
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  it.each(["sign-in", "account", "welcome", "agent", "docs", "providers"])(
    "uses the same shell and keyboard behavior for %s in both themes and viewport sizes",
    async (kind) => {
      const context = await browser.newContext();
      const signedIn = ["account", "providers"].includes(kind);
      await context.addInitScript(() => {
        if (window.top !== window) return;
        localStorage.setItem("tinytldr:welcome:v1", "seen");
      });
      const page = await context.newPage();
      try {
        await page.goto(site.baseUrl);
        if (signedIn) await site.signIn(page);
        const heading = page.frameLocator('iframe[title="Design preview"]').locator("h1");
        await heading.waitFor();
        await heading.evaluate((element) => {
          element.dataset.dialogProbe = "preserved";
        });
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
          { width: 320, height: 568 },
          { width: 640, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          for (const theme of ["Day", "Night"]) {
            await page
              .getByRole("group", { name: "Site appearance" })
              .getByRole("button", { name: theme, exact: true })
              .click();
            await expect
              .poll(() => page.locator("html").getAttribute("class"))
              .toContain(theme === "Day" ? "light" : "dark");
            if (kind === "welcome") {
              await page.getByRole("button", { name: "Welcome", exact: true }).click();
            } else if (kind === "docs") {
              await page.getByRole("button", { name: "MCP", exact: true }).click();
              await page
                .getByRole("dialog", { name: "Bring your agent." })
                .getByRole("button", { name: "Read the documentation" })
                .click();
              await page.getByRole("dialog", { name: "Documentation", exact: true }).waitFor();
            } else if (kind === "agent") {
              await sidebarAction(page, "Connect an Agent");
            } else {
              await sidebarAction(page, signedIn ? /^Account/ : /Sign in \/ Create account/);
              if (kind === "providers")
                await page.getByRole("button", { name: "Manage AI connection" }).click();
            }
            const dialog = page.locator("dialog.app-dialog[open]");
            await dialog.waitFor();
            expect(await dialog.count()).toBe(1);
            await expectDialogLayout(dialog, viewport);
            if (kind === "account") {
              const hintStyle = await dialog
                .locator(".account-hint")
                .first()
                .evaluate((element) => {
                  const style = getComputedStyle(element);
                  return { fontSize: style.fontSize, marginTop: style.marginTop };
                });
              expect(hintStyle).toEqual({ fontSize: "11px", marginTop: "8px" });
            }
            if (kind === "docs") {
              for (const section of [
                "Agent Workflow",
                "MCP Tools",
                "Template Authoring",
                "Self-Hosting",
                "Contribute",
                "Quickstart",
              ]) {
                await dialog
                  .locator("aside")
                  .getByRole("button", { name: section, exact: true })
                  .click();
                await expectDialogLayout(dialog, viewport);
              }
            }
            await dialog.locator(".dialog-close").focus();
            await page.keyboard.press("Shift+Tab");
            expect(
              await dialog.evaluate((element) => element.contains(document.activeElement)),
            ).toBe(true);
            await page.keyboard.press("Tab");
            expect(
              await dialog
                .locator(".dialog-close")
                .evaluate((element) => element === document.activeElement),
            ).toBe(true);
            await page.keyboard.press("Escape");
            await expect.poll(() => dialog.count()).toBe(0);
            expect(
              await page.evaluate(() => document.activeElement instanceof HTMLButtonElement),
            ).toBe(true);
            expect(await heading.getAttribute("data-dialog-probe")).toBe("preserved");
          }
        }
      } finally {
        await context.close();
      }
    },
  );

  it("keeps welcome initial focus and agent-to-documentation topic navigation", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(site.baseUrl);
      const welcome = page.getByRole("dialog", { name: "Welcome to tinytldr." });
      await welcome.waitFor();
      expect(
        await welcome
          .getByRole("button", { name: "Start Creating" })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      await welcome.getByRole("button", { name: "Start Creating", exact: true }).click();
      await sidebarAction(page, "Connect an Agent");
      const setup = page.getByRole("dialog", { name: "Bring your agent." });
      await setup.waitFor();
      expect(await setup.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      await setup.getByRole("button", { name: "Read the documentation" }).click();
      const docs = page.getByRole("dialog", { name: "Documentation", exact: true });
      await docs.waitFor();
      expect(await docs.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await docs.getByRole("button", { name: "Close", exact: true }).click();
      expect(await docs.count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});
