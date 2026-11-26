import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { textContrast } from "../../../test/contrast";
import { render } from "../../../test/render";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: ((environments: ReadonlyArray<{ environmentId: string }>) =>
    new Set(environments.map(({ environmentId }) => environmentId))) as never,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: vi.fn(() => vi.fn()) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environment = {
      environmentId: "env",
      label: "Build workstation",
      serverConfig: {
        keybindings: compileResolvedKeybindingsConfig([
          { command: "composer.sendBackground", key: "mod+alt+enter", when: "false" },
        ]),
        keybindingsConfigPath: null,
        availableEditors: [],
      },
    };
    return {
      scope: { kind: "environment" },
      environment,
      environments: [environment],
      connectedEnvironments: [environment],
      targets: [],
      target: null,
    };
  }) as never,
}));

import { KeybindingsSettingsPanel } from "./KeybindingsSettings";

describe("keyboard shortcut rows", () => {
  it.each(["light", "dark"] as const)(
    "draw every When label at least 4.5:1 against the row behind it in %s",
    async (scheme) => {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      // The glass panel is translucent; behind it the app is dark in dark mode.
      document.body.style.backgroundColor =
        scheme === "dark" ? "rgb(10 10 10)" : "rgb(255 255 255)";
      try {
        await using _screen = await render(
          <div data-app-modal="">
            <KeybindingsSettingsPanel />
          </div>,
        );
        await page.getByRole("button", { name: "Add shortcut" }).click();
        // A row shows its "When" line while it has focus, so focus one.
        const pill = page.getByRole("button", { name: /^Edit shortcut for Sidebar: toggle:/ });
        await expect.element(pill).toBeVisible();
        (pill.element() as HTMLElement).focus();
        const whenLabels = () =>
          [...document.querySelectorAll<HTMLElement>("span")].filter(
            (element) => element.children.length === 0 && element.textContent === "When",
          );
        // The focused row and the new-shortcut row.
        await vi.waitFor(() => expect(whenLabels().length).toBeGreaterThan(1));
        const labels = whenLabels();
        for (const label of labels) {
          const ratio = textContrast(label);
          // 5 rather than 4.5: the panel is translucent, so the row behind a label moves with the app.
          expect(ratio, `a When label in ${scheme}`).toBeGreaterThanOrEqual(5);
        }
      } finally {
        document.body.style.removeProperty("background-color");
        document.documentElement.classList.remove("dark");
      }
    },
  );

  it("keeps a shortcut row with no custom condition to one line, 44 px tall", async () => {
    await using screen = await render(
      <div data-app-modal="" className="w-[880px]">
        <KeybindingsSettingsPanel />
      </div>,
    );
    const pill = page.getByRole("button", { name: /^Edit shortcut for Sidebar: toggle:/ });
    await expect.element(pill).toBeVisible();
    const row = pill.element().closest<HTMLElement>('[data-slot="settings-row"]')!;
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(46);
    expect(row.querySelector("[data-settings-row-description]")).toBeNull();
    expect(screen.container.querySelector("[data-compact]")).not.toBeNull();
  });
});
