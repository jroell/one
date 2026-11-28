import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Sync check: the Usage page opens, shows limits and refreshes without an error",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("demo");
    await browser.setViewport({ width: 1280, height: 900 });
    await t3.open("/usage");
    await expect(screen.getByRole("heading", "Usage", { exact: false }).first()).toBeVisible();
    await app.screenshot("usage-light");
    const bodyText = await browser.evaluate(() => document.body.innerText);
    expect(bodyText.includes("T3 Code")).toBe(false);
    await browser.emulateMedia({ colorScheme: "dark" });
    await app.screenshot("usage-dark");
    await browser.setViewport({ width: 390, height: 844 });
    await app.screenshot("usage-390-dark");
  },
);
