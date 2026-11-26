import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { SettingsSheetSkeleton } from "./SettingsSheetSkeleton";

describe("the settings sheet's outline", () => {
  it("stays invisible for the first 250 ms, so a page that mounts quickly never shows scaffolding", async () => {
    await using screen = await render(
      <div className="app-route-modal-late flex" style={{ width: 900, height: 500 }}>
        <SettingsSheetSkeleton />
      </div>,
      { router: false },
    );
    const late = screen.container.querySelector<HTMLElement>(".app-route-modal-late")!;
    const style = getComputedStyle(late);
    expect(style.animationName).toBe("app-route-modal-late");
    expect(style.animationDelay).toBe("0.25s");
    // The delay holds the first keyframe: nothing is drawn before it ends.
    expect(style.opacity).toBe("0");
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
