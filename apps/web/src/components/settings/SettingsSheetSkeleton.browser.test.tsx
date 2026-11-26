import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { AppRouteModal } from "../AppRouteModal";
import { SettingsSheetSkeleton } from "./SettingsSheetSkeleton";

vi.mock("../chat/GlobalVoiceInputIndicator", () => ({ GlobalVoiceInputIndicator: () => null }));

describe("the settings sheet's outline", () => {
  it("stays invisible for the first 250 ms inside the real modal, then gives way to the page", async () => {
    // Hold the modal's frame timer, so the outline is on screen for as long as the test looks at it.
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      await using _screen = await render(
        <AppRouteModal label="Settings" skeleton={<SettingsSheetSkeleton />}>
          <div data-testid="page">The page</div>
        </AppRouteModal>,
        { router: "/settings/general" },
      );
      const late = document.querySelector<HTMLElement>(".app-route-modal-late")!;
      const style = getComputedStyle(late);
      expect(style.animationName).toBe("app-route-modal-late");
      expect(style.animationDelay).toBe("0.25s");
      // The delay holds the first keyframe: nothing is drawn before it ends.
      expect(style.opacity).toBe("0");
      expect(late.querySelector('[data-slot="skeleton"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="page"]')).toBeNull();

      raf.mockRestore();
      for (const callback of frames) callback(0);
      await vi.waitFor(() => expect(document.querySelector('[data-testid="page"]')).not.toBeNull());
      expect(document.querySelector(".app-route-modal-late")).toBeNull();
    } finally {
      raf.mockRestore();
    }
  });

  it("is laid out as the real sheet is: the real rail width, a 48 px header, a centered page of at most 720 px", async () => {
    await using screen = await render(
      <div style={{ width: 1200, height: 600, display: "flex" }}>
        <SettingsSheetSkeleton />
      </div>,
      { router: false },
    );
    const outline = screen.container.firstElementChild!.firstElementChild as HTMLElement;
    const rail = outline.firstElementChild as HTMLElement;
    const column = outline.lastElementChild as HTMLElement;
    const header = column.firstElementChild as HTMLElement;
    const page = column.lastElementChild as HTMLElement;
    // 240 px from the md breakpoint up, the 56 px icon rail below it, as the real rail is.
    expect(rail.getBoundingClientRect().width).toBe(
      matchMedia("(min-width: 48rem)").matches ? 240 : 56,
    );
    expect(header.getBoundingClientRect().height).toBe(48);
    const pane = column.getBoundingClientRect();
    const box = page.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.left - pane.left - (pane.right - box.right))).toBeLessThanOrEqual(1);
  });
});
