import type { Page } from "playwright";

/**
 * Picks Day or Night from a mounted site appearance toggle. Phone workspaces keep the toggle in the
 * closed sidebar drawer (and loading swaps footer for drawer), so this dispatches the click directly;
 * CompactHeaderBrowser covers real pointer clicks on each toggle.
 */
export async function chooseSiteTheme(page: Page, theme: string) {
  const buttons = page.locator(`.theme-toggle button[title="${theme} appearance"]`);
  await buttons.first().waitFor({ state: "attached" });
  // Loading swaps chrome, so a click can land on a detached toggle; retry until the reveal settles.
  await page.waitForFunction(
    ({ title, name }) => {
      const transitioning = document
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect | null)?.pseudoElement?.includes("view-transition"),
        );
      if (transitioning) return false;
      if (document.documentElement.classList.contains(name)) return true;
      document.querySelector<HTMLElement>(`.theme-toggle button[title="${title}"]`)?.click();
      return false;
    },
    { title: `${theme} appearance`, name: theme === "Day" ? "light" : "dark" },
    { polling: 100 },
  );
}

/** Opens a footer resource, or the sidebar drawer's More menu where phones keep those links. */
export async function openSiteResource(page: Page, name: "Welcome" | "MCP" | "Privacy" | "Terms") {
  const footer = page.getByRole("contentinfo", { name: "Site footer" });
  if (await footer.isVisible()) {
    return footer
      .getByRole(name === "Welcome" || name === "MCP" ? "button" : "link", {
        name,
        exact: true,
      })
      .click();
  }
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Your designs menu" })
    .getByRole("button", { name: "More site links", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "Site resources" })
    .getByRole("menuitem", { name, exact: true })
    .click();
}
