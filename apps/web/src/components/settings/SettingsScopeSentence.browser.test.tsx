import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

const scopeState = vi.hoisted(() => ({
  project: undefined as string | undefined,
  // Two projects by default, so the bar has a choice to show.
  groups: [
    { projectKey: "first-key", displayName: "Project", memberProjects: [] },
    { projectKey: "other-key", displayName: "Other", memberProjects: [] },
  ] as ReadonlyArray<object>,
}));

vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useOptionalSettingsScope: (() => ({
    search: scopeState.project ? { project: scopeState.project } : {},
    scope: { kind: "all", environmentIds: [] },
    groups: scopeState.groups,
    environments: [],
    connectedEnvironments: [],
    singleEnvironment: false,
    selectScope: vi.fn(),
  })) as never,
}));

import { SettingsScopeSentence } from "./SettingsScopeSentence";

describe("settings scope bar", () => {
  it("stays off the project list, where the list is the choice, and shows once a project is open", async () => {
    scopeState.project = undefined;
    await using chooser = await render(<SettingsScopeSentence />, { router: "/settings/projects" });
    expect(chooser.container.querySelector("[data-settings-scope]")).toBeNull();

    await using elsewhere = await render(<SettingsScopeSentence />, { router: "/settings/voice" });
    expect(elsewhere.container.querySelector("[data-settings-scope]")).not.toBeNull();

    scopeState.project = "project-key";
    await using opened = await render(<SettingsScopeSentence />, { router: "/settings/projects" });
    expect(opened.container.querySelector("[data-settings-scope]")).not.toBeNull();
  });

  it("is hidden for one project on one machine only on a page with no per-project settings", async () => {
    scopeState.project = undefined;
    scopeState.groups = [{ projectKey: "only", displayName: "Only", memberProjects: [] }];
    try {
      // Nothing to choose between here: no row on this page can write a per-project override.
      await using plain = await render(<SettingsScopeSentence />, {
        router: "/settings/scheduled-tasks",
      });
      expect(plain.container.querySelector("[data-settings-scope]")).toBeNull();
      await plain.unmount();

      // Threads can: the project menu is the only way to reach them, so the bar stays, shorter.
      await using scoped = await render(<SettingsScopeSentence />, { router: "/settings/threads" });
      const bar = scoped.container.querySelector("[data-settings-scope]")!;
      expect(bar.textContent).toMatch(/^Applying settings for/);
      expect(bar.textContent).not.toMatch(/\bon\b/);
      expect(bar.querySelector("[data-explain-trigger]")).not.toBeNull();
    } finally {
      scopeState.groups = [
        { projectKey: "first-key", displayName: "Project", memberProjects: [] },
        { projectKey: "other-key", displayName: "Other", memberProjects: [] },
      ];
    }
    await using shown = await render(<SettingsScopeSentence />, { router: "/settings/voice" });
    expect(
      shown.container.querySelector("[data-settings-scope] [data-explain-trigger]"),
    ).not.toBeNull();
  });

  it('words the bar on every page as a verb, the project, then "on" the environment', async () => {
    scopeState.project = undefined;
    await using settings = await render(<SettingsScopeSentence />, { router: "/settings/voice" });
    const text = settings.container.querySelector("[data-settings-scope]")!.textContent!;
    expect(text).toMatch(/^Applying settings for/);
    expect(text).not.toContain("across");
    await settings.unmount();

    await using filter = await render(<SettingsScopeSentence />, {
      router: "/settings/diagnostics",
    });
    expect(filter.container.querySelector("[data-settings-scope]")!.textContent).toMatch(
      /^Showing.*on/,
    );
  });
});
