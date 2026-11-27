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
  it("keeps the page being left on screen until the next page has mounted, then shows the next page in that same frame", async () => {
    await using screen = await render(<Pages />, { router: "/settings/general" });
    await expect.element(screen.getByText("Body of /settings/general")).toBeVisible();

    // What a frame could have shown, in order: the copy arriving, then the copy leaving with the
    // new page already in place.
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.matches("[data-settings-outgoing]")) {
            seen.push(`held: ${node.textContent}`);
          }
        }
        for (const node of record.removedNodes) {
          if (node instanceof HTMLElement && node.matches("[data-settings-outgoing]")) {
            const next = document.querySelector("[data-settings-page-scroll]")?.textContent;
            seen.push(`released, page now: ${next}`);
          }
        }
      }
    });
    observer.observe(screen.container, { childList: true, subtree: true });
    await screen.router!.navigate({ to: "/settings/appearance" });

    await vi.waitFor(() => expect(seen.some((entry) => entry.startsWith("released"))).toBe(true));
    observer.disconnect();
    expect(seen[0]).toContain("Body of /settings/general");
    expect(seen.find((entry) => entry.startsWith("released"))).toContain(
      "Body of /settings/appearance",
    );
  });

  it("never leaves the old page's copy over a page that has mounted, so heading and breadcrumb agree in the frame the page arrives", async () => {
    await using screen = await render(<Pages />, { router: "/settings/general" });
    await expect.element(screen.getByText("Body of /settings/general")).toBeVisible();
    // After every batch of DOM changes (one commit), the copy and the page it was held for must
    // not both be on screen: a copy that lingers keeps the old heading under the new breadcrumb.
    const overlaps: string[] = [];
    const observer = new MutationObserver(() => {
      const copy = document.querySelector("[data-settings-outgoing]");
      const page = document.querySelector("[data-settings-page-scroll]");
      const arrived = page?.textContent?.includes(
        `Body of ${screen.router!.state.location.pathname}`,
      );
      if (copy !== null && arrived) overlaps.push(`${copy.textContent} over ${page?.textContent}`);
    });
    observer.observe(screen.container, { childList: true, subtree: true });
    for (const path of ["/settings/appearance", "/settings/chat", "/settings/voice"]) {
      await screen.router!.navigate({ to: path });
      await expect.element(screen.getByText(`Body of ${path}`)).toBeVisible();
      await vi.waitFor(() =>
        expect(screen.container.querySelector("[data-settings-outgoing]")).toBeNull(),
      );
    }
    observer.disconnect();
    expect(overlaps).toEqual([]);
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
    // The copy goes at once; the page it covered fades up from half strength.
    expect(copy.isConnected).toBe(false);
    const hover = getComputedStyle(document.documentElement).getPropertyValue("--mo-hover").trim();
    const style = getComputedStyle(pageEl);
    expect(pageEl.hasAttribute("data-settings-arriving")).toBe(true);
    expect(style.animationName).toBe("settings-arrive");
    expect(style.animationDuration).toBe(`${Number.parseFloat(hover) / 1000}s`);
  });

  it("keeps fading the arriving page until its own fade ends, even when an animation inside it ends sooner", async () => {
    const style = document.createElement("style");
    style.textContent =
      "@keyframes blip { from { opacity: 0.99; } } [data-blip] { animation: blip 10ms; }";
    document.head.append(style);
    try {
      await using screen = await render(
        <div data-app-modal="" style={{ position: "relative", height: 300, width: 600 }}>
          <SettingsPageContainer>
            <SettingsSection title="Section">
              <div data-blip="">small</div>
            </SettingsSection>
          </SettingsPageContainer>
        </div>,
        { router: "/settings/general" },
      );
      const pageEl = screen.container.querySelector<HTMLElement>("[data-settings-page-scroll]")!;
      holdOutgoingSettingsPage();
      releaseOutgoingSettingsPage();
      const startedAt = Number(document.timeline.currentTime);
      const fadeMs = Number(
        pageEl
          .getAnimations()
          .find((animation) => (animation as CSSAnimation).animationName === "settings-arrive")!
          .effect!.getComputedTiming().duration,
      );
      let endedAfter: number | null = null;
      new MutationObserver(() => {
        if (!pageEl.hasAttribute("data-settings-arriving"))
          endedAfter ??= Number(document.timeline.currentTime) - startedAt;
      }).observe(pageEl, { attributes: true, attributeFilter: ["data-settings-arriving"] });
      await vi.waitFor(() => expect(endedAfter).not.toBeNull());
      expect(endedAfter!).toBeGreaterThanOrEqual(fadeMs);
    } finally {
      style.remove();
    }
  });
});
