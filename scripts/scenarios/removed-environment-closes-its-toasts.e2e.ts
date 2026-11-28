import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { SECOND_HOME, startSecondServer } from "./second-server.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

test(
  "Removing an environment closes the in-app notifications it raised",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const project = await t3.project("demo");
    const primaryThread = await t3.thread({
      project,
      title: "Finished here",
      messages: ["first"],
    });
    const primary = makeState(T3_HOME);
    const second = makeState(SECOND_HOME);
    const server = startSecondServer(app.baseUrl ?? "");
    try {
      const { host, token } = await server.ready;
      const project = await second.state.project("remote-demo");
      const thread = await second.state.thread({
        project,
        title: "Finished elsewhere",
        messages: ["first"],
      });

      await t3.open("/settings/general");
      await screen.getByRole("switch", "In-app notifications").check();
      await app.open("/settings/connections");
      await screen.getByRole("button", "Add environment").tap();
      const dialog = screen.getByRole("dialog");
      await dialog.getByPlaceholder("backend.example.com").fill(host);
      await dialog.getByPlaceholder("PAIRCODE").fill(token);
      await dialog.getByRole("button", "Add environment").tap();
      // The page opens on a map of machines; each machine's actions menu is in the list view.
      await screen.getByRole("button", "List", { exact: true }).tap();
      const moreActions = screen.getByRole("button", "More actions for Scenario");
      await expect(moreActions).toBeVisible({ timeout: 60_000 });

      // The client announces only a change it saw happen, so it must hold the thread first.
      await expect(screen.getByText("Finished elsewhere").first()).toBeVisible({ timeout: 60_000 });
      await runPromise(
        primary.cli(["thread", "send", primaryThread.threadId, "second", "--wait", "--json"]),
      );
      const primaryToast = browser.locator(
        '[data-slot="toast-description"]:has-text("Finished here")',
      );
      await expect(primaryToast).toBeVisible({ timeout: 60_000 });
      await primaryToast.hover();
      await runPromise(
        second.cli(["thread", "send", thread.threadId, "second", "--wait", "--json"]),
      );
      // One shows a single notification at a time. The other machine's waits behind it as a "+N"
      // count (the earlier "Backend added" notice waits there too) and has no timer while it waits.
      const waiting = browser.locator('[data-slot="toast-count"]');
      await expect(waiting).toHaveAttribute("aria-label", "2 more notifications", {
        timeout: 60_000,
      });

      // The removal goes by keyboard so the pointer stays on the notification on screen.
      await primaryToast.hover();
      await moreActions.press("Enter");
      await screen.getByRole("menuitem", "Remove from this device…").press("Enter");
      await expect(waiting).toHaveAttribute("aria-label", "2 more notifications");
      await screen.getByRole("button", "Remove environment", { exact: true }).press("Enter");
      try {
        await expect(waiting).toHaveAttribute("aria-label", "1 more notifications");
        // The notification from the machine that stays is untouched.
        await expect(primaryToast).toBeVisible();
      } finally {
        await app.screenshot("after-removal");
      }
      await expect(moreActions).toBeHidden({ timeout: 30_000 });
    } finally {
      await server.stop();
    }
  },
);
