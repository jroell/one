import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  openCommandPalette: vi.fn(),
  groups: [] as unknown[],
}));

vi.mock(import("../../commandPaletteBus"), async (original) => ({
  ...(await original()),
  openCommandPalette: state.openCommandPalette as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    search: {},
    groups: state.groups,
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

  it("heads the list of projects with a section title that carries Add project on its right", async () => {
    state.groups = [
      {
        projectKey: "server",
        displayName: "server",
        workspaceRoot: "/Users/me/server",
        archived: false,
        projectIcon: { kind: "monogram", text: "SR", color: "orange" },
        memberProjects: [],
      },
    ];
    try {
      await using screen = await render(
        <SettingsScopeNotice quiet withAddProject target="project">
          Choose a project.
        </SettingsScopeNotice>,
        { router: "/settings/projects" },
      );
      const heading = screen.getByRole("heading", { name: "Your projects" }).element();
      const add = screen.getByRole("button", { name: "Add project" }).element();
      const title = heading.getBoundingClientRect();
      const button = add.getBoundingClientRect();
      // One header row: the title on the left, the button on the right, on the same line.
      expect(button.left).toBeGreaterThan(title.right);
      expect(
        Math.abs(button.top + button.height / 2 - (title.top + title.height / 2)),
      ).toBeLessThan(title.height);
    } finally {
      state.groups = [];
    }
  });
});
