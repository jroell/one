import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { SettingsEmptyState } from "./SettingsEmptyState";
import { SettingsSection } from "./settingsLayout";

const empty = <SettingsEmptyState icon={<span />} title="Nothing yet" description="Add one." />;

describe("settings empty state", () => {
  it("sits in one card on a plain section, and adds none inside a section panel that is already a card", async () => {
    await using plain = await render(
      <SettingsSection title="Archive" hideTitle variant="plain">
        {empty}
      </SettingsSection>,
      { router: false },
    );
    const alone = plain.container.querySelector<HTMLElement>("[data-settings-empty]")!;
    expect(getComputedStyle(alone).borderTopWidth).toBe("1px");
    expect(getComputedStyle(alone).borderTopLeftRadius).not.toBe("0px");
    await plain.unmount();

    await using grouped = await render(<SettingsSection title="Tasks">{empty}</SettingsSection>, {
      router: false,
    });
    const inside = grouped.container.querySelector<HTMLElement>("[data-settings-empty]")!;
    expect(getComputedStyle(inside).borderTopWidth).toBe("0px");
    const panel = inside.closest<HTMLElement>('[data-slot="settings-group"]')!;
    expect(getComputedStyle(panel).borderTopWidth).toBe("1px");
  });
});
