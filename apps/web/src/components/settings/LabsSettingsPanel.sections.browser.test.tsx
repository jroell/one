import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";

import "../../index.css";
import { render } from "../../../test/render";

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => ({ ...DEFAULT_UNIFIED_SETTINGS, workflowsEnabled: true })) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => vi.fn(),
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useOptionalSettingsScope: () => null,
  useSettingsScope: () =>
    ({
      scope: { kind: "all", environmentIds: [] },
      connectedEnvironments: [],
      environments: [],
      groups: [],
    }) as never,
}));

import { LabsSettingsPanel } from "./LabsSettingsPanel";

describe("Labs page", () => {
  it("groups its switches under four headings of at most three rows each, not one wall of rows", async () => {
    await using screen = await render(<LabsSettingsPanel />, { router: "/settings/labs" });

    const sections = [...screen.container.querySelectorAll("section")];
    expect(sections.map((section) => section.querySelector("h2")?.textContent)).toEqual([
      "Sidebar and composer",
      "Sharing and linking",
      "Agents and workflows",
      "Devices and worktrees",
    ]);
    for (const section of sections) {
      const rows = section.querySelectorAll('[data-slot="settings-row"]').length;
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThanOrEqual(4);
    }
  });
});
