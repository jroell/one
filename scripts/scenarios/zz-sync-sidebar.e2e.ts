import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Sync check: Boring sidebar folders list six threads with Show more and Show less, and rows name their provider",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const project = await t3.project("demo");
    for (let index = 1; index <= 8; index += 1) {
      await t3.thread({ project, title: `Folder work ${index}`, messages: ["first"] });
    }
    await browser.setViewport({ width: 1280, height: 900 });
    await t3.open("/settings/labs");
    await screen.getByRole("switch", "Group threads by project").check();
    await t3.open();
    await expect(screen.getByText("Folder work 8", { exact: false }).first()).toBeVisible();
    const more = screen.getByRole("button", "Show 2 more");
    await expect(more).toBeVisible();
    await app.screenshot("folder-preview-light");
    await more.tap();
    await expect(screen.getByText("Folder work 1", { exact: false }).first()).toBeVisible();
    await expect(screen.getByRole("button", "Show less")).toBeVisible();
    await app.screenshot("folder-expanded-light");
    const bodyText = await browser.evaluate(() => document.body.innerText);
    expect(bodyText.includes("T3 Code")).toBe(false);
    await browser.emulateMedia({ colorScheme: "dark" });
    await app.screenshot("folder-expanded-dark");
  },
);
