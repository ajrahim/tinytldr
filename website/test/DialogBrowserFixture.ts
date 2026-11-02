import { expect } from "vitest";
import type { Locator } from "playwright";

export async function expectDialogLayout(
  dialog: Locator,
  viewport: { width: number; height: number },
) {
  const layout = await dialog.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(".app-dialog-header");
    const body = element.querySelector<HTMLElement>(".app-dialog-body");
    const footer = element.querySelector<HTMLElement>(".app-dialog-footer");
    const title = element.querySelector<HTMLElement>(".app-dialog-title");
    const close = element.querySelector<HTMLElement>(".dialog-close");
    if (!header || !body || !footer || !title || !close)
      throw new Error("Missing shared dialog regions.");
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      overflow: element.scrollWidth - element.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      radius: getComputedStyle(element).borderRadius,
      font: getComputedStyle(title).fontSize,
      headerPadding: getComputedStyle(header).paddingLeft,
      bodyPadding: getComputedStyle(body).paddingLeft,
      bodyControls: Array.from(body.querySelectorAll<HTMLElement>("button, input, a[href]"))
        .filter((control) => control.getClientRects().length > 0)
        .map((control) => ({
          left: control.getBoundingClientRect().left,
          right: control.getBoundingClientRect().right,
        })),
      closeTop: close.getBoundingClientRect().top,
      footerBottom: footer.getBoundingClientRect().bottom,
      backdrop: getComputedStyle(element, "::backdrop").backgroundColor,
      primary: Array.from(
        element.querySelectorAll(".primary-button"),
        (button) => getComputedStyle(button).backgroundColor,
      ),
      light: document.documentElement.classList.contains("light"),
      welcome: element.classList.contains("is-welcome"),
    };
  });
  expect(layout.x).toBeGreaterThanOrEqual(0);
  expect(layout.y).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(layout.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.bodyOverflow).toBeLessThanOrEqual(1);
  expect(layout.radius).toBe("8px");
  expect(layout.font).toBe(layout.welcome ? "15.2px" : "18px");
  expect(layout.headerPadding).toBe(
    layout.welcome ? "0px" : viewport.width <= 420 ? "16px" : "20px",
  );
  expect(layout.bodyPadding).toBe(layout.welcome ? "44px" : layout.headerPadding);
  for (const control of layout.bodyControls) {
    expect(control.left).toBeGreaterThanOrEqual(layout.x - 1);
    expect(control.right).toBeLessThanOrEqual(layout.right + 1);
  }
  expect(layout.closeTop).toBeGreaterThanOrEqual(layout.y);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.bottom);
  expect(layout.backdrop).toBe("rgba(0, 0, 0, 0.333)");
  for (const background of layout.primary)
    expect(background).toBe(layout.light ? "rgb(17, 17, 19)" : "rgb(244, 244, 245)");
}
