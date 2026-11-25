import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ openCommandPalette: vi.fn() }));

vi.mock(import("../../commandPaletteBus"), async (original) => ({
  ...(await original()),
  openCommandPalette: state.openCommandPalette as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    search: {},
    groups: [],
    selectScope: vi.fn(),
  })) as never,
}));

import { SettingsScopeNotice } from "./SettingsScopeNotice";

describe("the project list", () => {
  it("offers Add project, and opens the palette's add-project flow, when there is no project yet", async () => {
    state.openCommandPalette.mockReset();
    await using screen = await render(
      <SettingsScopeNotice quiet withAddProject target="project">
        Choose a project.
      </SettingsScopeNotice>,
      { router: "/settings/projects" },
    );

    await expect.element(screen.getByText("No projects yet")).toBeVisible();
    await screen.getByRole("button", { name: "Add project" }).click();
    expect(state.openCommandPalette).toHaveBeenCalledWith({ open: "add-project" });
  });
});
