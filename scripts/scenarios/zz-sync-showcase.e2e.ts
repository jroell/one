import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Sync check: a showcase thread keeps One's mode switch, Read aloud and brand in light, dark and 390 px",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const project = await t3.project("demo", { "src/math.ts": "export const sum = 1 + 1;\n" });
    const thread = await t3.thread({
      project,
      title: "Showcase",
      messages: ["Give me a short tour"],
      model: "showcase",
    });
    await browser.setViewport({ width: 1280, height: 900 });
    await t3.open(thread);
    await expect(screen.getByText("This turn is a replay.", { exact: false })).toBeVisible();
    await expect(screen.getByRole("radiogroup", "Workspace mode")).toBeVisible();
    await expect(screen.getByRole("button", "Read aloud").first()).toBeAttached();
    const bodyText = await browser.evaluate(() => document.body.innerText);
    expect(bodyText.includes("T3 Code")).toBe(false);
    await app.screenshot("showcase-light");
    await browser.emulateMedia({ colorScheme: "dark" });
    await app.screenshot("showcase-dark");

    await screen.getByRole("textbox").fill("Another short tour");
    await screen.getByRole("textbox").press("Enter");
    await expect(screen.getByText("Another short tour").first()).toBeVisible();
    await expect(screen.getByRole("button", "Stop generation")).toBeHidden();
    await app.screenshot("second-turn-dark");

    await browser.setViewport({ width: 390, height: 844 });
    await app.screenshot("showcase-390-dark");
    const width = await browser.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll <= width.client).toBe(true);
  },
);
