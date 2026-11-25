import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

const scopeState = vi.hoisted(() => ({ project: undefined as string | undefined }));

vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useOptionalSettingsScope: (() => ({
    search: scopeState.project ? { project: scopeState.project } : {},
    scope: { kind: "all", environmentIds: [] },
    groups: [],
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
});
