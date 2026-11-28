import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Sync check: the welcome page and About settings describe pseudonymous usage data collected by One",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.open();
    await expect(
      screen.getByText("One collects pseudonymous product usage data", { exact: false }),
    ).toBeVisible();
    await app.screenshot("welcome-light");
    await browser.setViewport({ width: 390, height: 844 });
    await app.screenshot("welcome-390");
    const welcomeWidth = await browser.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(welcomeWidth.scroll <= welcomeWidth.client).toBe(true);
    await browser.setViewport({ width: 1280, height: 900 });

    await t3.project("demo");
    await t3.open("/settings/about");
    await expect(
      screen.getByText("pseudonymous product usage data One collects", { exact: false }),
    ).toBeVisible();
    const bodyText = await browser.evaluate(() => document.body.innerText);
    expect(bodyText.includes("T3 Code")).toBe(false);
    await app.screenshot("about-light");
    await browser.emulateMedia({ colorScheme: "dark" });
    await app.screenshot("about-dark");
  },
);
