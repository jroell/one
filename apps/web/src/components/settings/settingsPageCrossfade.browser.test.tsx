import { useLocation } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import {
  holdOutgoingSettingsPage,
  releaseOutgoingSettingsPage,
  useHoldOutgoingSettingsPage,
} from "./settingsPageCrossfade";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const title = (path: string) => `Page ${path.split("/").at(-1)}`;

function Pages() {
  useHoldOutgoingSettingsPage();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div data-app-modal="" style={{ position: "relative", height: 400, width: 700 }}>
      <SettingsPageContainer key={pathname}>
        <SettingsSection title={title(pathname)}>
          <div>Body of {pathname}</div>
        </SettingsSection>
      </SettingsPageContainer>
    </div>
  );
}

describe("changing a settings page", () => {
  it("keeps the page being left on screen as a still copy over its place, and fades it out only once the next page has mounted", async () => {
    await using screen = await render(<Pages />, { router: "/settings/general" });
    await expect.element(screen.getByText("Body of /settings/general")).toBeVisible();

    // Records, in order, what a frame could have shown: the copy arriving, the new page
    // being there when the copy starts to leave.
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.matches("[data-settings-outgoing]")) {
            seen.push(`held: ${node.textContent}`);
          }
        }
        if (
          record.type === "attributes" &&
          record.target instanceof HTMLElement &&
          record.target.hasAttribute("data-settings-leaving")
        ) {
          const next = document.querySelector("[data-settings-page-scroll]")?.textContent;
          seen.push(`leaving, page now: ${next}`);
        }
      }
    });
    observer.observe(screen.container, { childList: true, subtree: true, attributes: true });
    await screen.router!.navigate({ to: "/settings/appearance" });

    await vi.waitFor(() => expect(seen.some((entry) => entry.startsWith("leaving"))).toBe(true));
    observer.disconnect();
    expect(seen[0]).toContain("Body of /settings/general");
    expect(seen.find((entry) => entry.startsWith("leaving"))).toContain(
      "Body of /settings/appearance",
    );
    await vi.waitFor(() =>
      expect(screen.container.querySelector("[data-settings-outgoing]")).toBeNull(),
    );
  });

  it("makes the copy a picture: over the page's own place, hidden from reading, with no focus and no repeated ids", async () => {
    await using screen = await render(
      <div data-app-modal="" style={{ position: "relative", height: 300, width: 600 }}>
        <SettingsPageContainer>
          <SettingsSection title="Section" id="setting-section">
            <button type="button">Press</button>
          </SettingsSection>
        </SettingsPageContainer>
      </div>,
      { router: "/settings/general" },
    );
    const pageEl = screen.container.querySelector<HTMLElement>("[data-settings-page-scroll]")!;
    holdOutgoingSettingsPage();
    const copy = screen.container.querySelector<HTMLElement>("[data-settings-outgoing]")!;
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    expect(copy.hasAttribute("inert")).toBe(true);
    expect(copy.querySelector("[id]")).toBeNull();
    expect(copy.hasAttribute("data-settings-page-scroll")).toBe(false);
    expect(copy.getBoundingClientRect().height).toBe(pageEl.getBoundingClientRect().height);
    expect(copy.getBoundingClientRect().top).toBe(pageEl.getBoundingClientRect().top);

    releaseOutgoingSettingsPage();
    const quick = getComputedStyle(document.documentElement).getPropertyValue("--mo-quick").trim();
    const style = getComputedStyle(copy);
    expect(style.animationName).toBe("settings-fade-out");
    expect(style.animationDuration).toBe(`${Number.parseFloat(quick) / 1000}s`);
    await vi.waitFor(() => expect(copy.isConnected).toBe(false));
  });
});
