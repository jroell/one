import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { Button } from "../ui/button";
import { EmptyGhostRows, SettingsEmptyState } from "./SettingsEmptyState";
import { SettingsSection } from "./settingsLayout";

const empty = <SettingsEmptyState icon={<span />} title="Nothing yet" description="Add one." />;

describe("settings empty state", () => {
  it("is a raised card on a plain section, and adds none inside a section panel that is already a card", async () => {
    await using plain = await render(
      <SettingsSection title="Archive" hideTitle variant="plain">
        {empty}
      </SettingsSection>,
      { router: false },
    );
    const alone = plain.container.querySelector<HTMLElement>("[data-settings-empty-card]")!;
    // The shared raised material: a rim drawn by ::before and a shadow.
    expect(getComputedStyle(alone, "::before").content).toBe('""');
    expect(getComputedStyle(alone).boxShadow).not.toBe("none");
    expect(getComputedStyle(alone).borderTopLeftRadius).not.toBe("0px");
    await plain.unmount();

    await using grouped = await render(<SettingsSection title="Tasks">{empty}</SettingsSection>, {
      router: false,
    });
    const inside = grouped.container.querySelector<HTMLElement>("[data-settings-empty-card]")!;
    expect(getComputedStyle(inside).boxShadow).toBe("none");
    expect(getComputedStyle(inside, "::before").display).toBe("none");
    const panel = inside.closest<HTMLElement>('[data-slot="settings-group"]')!;
    expect(getComputedStyle(panel, "::before").content).toBe('""');
  });

  it("shows a preview of the filled page beside the text in a wide card, and only the text in a narrow one", async () => {
    const state = (
      <SettingsEmptyState
        title="No scheduled tasks yet"
        description="A scheduled task runs a prompt on a timer."
        action={<Button>New task</Button>}
        preview={
          <EmptyGhostRows
            rows={[
              { icon: <span />, title: "Morning summary", meta: "Every weekday at 8:00 AM" },
              { icon: <span />, title: "Weekly check", meta: "Every Monday at 9:00 AM" },
            ]}
          />
        }
      />
    );
    const wide = document.createElement("div");
    wide.style.width = "800px";
    await using wideScreen = await render(state, { container: wide, router: false });
    const preview = wideScreen.container.querySelector<HTMLElement>(
      "[data-settings-empty-preview]",
    )!;
    expect(preview.getBoundingClientRect().width).toBeGreaterThan(200);
    // The preview is decoration: hidden from the accessibility tree, and the action is the only button.
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(wideScreen.container.querySelectorAll("button")).toHaveLength(1);
    // It reads as an example, not as the person's own data: a caption and a lowered opacity.
    expect(preview.querySelector("[data-slot=empty-example-caption]")!.textContent).toBe("Example");
    expect(Number(getComputedStyle(preview.lastElementChild!).opacity)).toBeLessThan(0.8);
    await wideScreen.unmount();

    const narrow = document.createElement("div");
    narrow.style.width = "320px";
    await using narrowScreen = await render(state, { container: narrow, router: false });
    expect(
      narrowScreen.container
        .querySelector<HTMLElement>("[data-settings-empty-preview]")!
        .getBoundingClientRect().width,
    ).toBe(0);
  });

  it("wraps an empty state's sentence within 36 characters and draws no icon tile", async () => {
    await using screen = await render(
      <SettingsEmptyState
        title="No archived threads"
        description="Archive a thread from its menu in the sidebar to set it aside. It waits here until you restore it."
      />,
      { router: false },
    );
    const text = screen.container.querySelector<HTMLElement>('[data-slot="empty-description"]')!;
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
    const lines = Math.round(text.getBoundingClientRect().height / lineHeight);
    expect(lines).toBeGreaterThan(1);
    expect(text.getBoundingClientRect().width).toBeLessThanOrEqual(
      36 * Number.parseFloat(getComputedStyle(text).fontSize),
    );
    expect(screen.container.querySelector("[data-ui-tile]")).toBeNull();
  });
});
