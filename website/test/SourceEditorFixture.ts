import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import { TemplateManifestSchema, type TemplateManifest } from "@tinytldr/core";

export async function showSourceEditors(page: Page) {
  const toggle = page.getByRole("button", { name: "Source editors", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByRole("textbox", { name: "Template HTML", exact: true }).waitFor();
}

export async function setSource(page: Page, language: "HTML" | "CSS" | "JSON", value: string) {
  await showSourceEditors(page);
  const editor = page.getByRole("textbox", { name: `Template ${language}`, exact: true });
  await editor.click();
  await editor.press("ControlOrMeta+a");
  if (!value) {
    await editor.press("Backspace");
    return;
  }
  // Paste replaces the full CodeMirror selection, including virtualized lines.
  await editor.evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    const handled = !element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
    );
    if (!handled) throw new Error("The source editor did not handle the paste.");
  }, value);
}

export async function chooseAction(page: Page, name: string) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

export async function downloadSource(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await chooseAction(page, name);
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("Source download was not created.");
  return { download, text: await readFile(path, "utf8") };
}

export async function editTemplate(page: Page, update: (manifest: TemplateManifest) => void) {
  const source = await downloadSource(page, "Template JSON");
  const manifest = TemplateManifestSchema.parse(JSON.parse(source.text));
  update(manifest);
  await setSource(page, "JSON", JSON.stringify(manifest, null, 2));
}
