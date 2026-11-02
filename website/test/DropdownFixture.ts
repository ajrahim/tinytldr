import type { Locator } from "playwright";

export async function chooseDropdown(control: Locator, value: string | number) {
  const id = await control.getAttribute("aria-controls");
  if (!id) throw new Error("Dropdown trigger has no associated listbox.");
  await control.click();
  await control
    .page()
    .locator(`[id=${JSON.stringify(id)}]`)
    .locator(`[role="option"][data-value=${JSON.stringify(String(value))}]`)
    .click();
}
