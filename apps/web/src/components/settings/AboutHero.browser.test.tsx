import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { AboutHero } from "./AboutHero";

describe("the About page's brand moment", () => {
  it("draws the ring at 176 px above a 48 px serif wordmark, and keeps it alive to the pointer", async () => {
    await using screen = await render(
      <div style={{ width: 720 }}>
        <AboutHero />
      </div>,
      { router: false },
    );
    const mark = screen.container.querySelector<HTMLElement>("[data-one-mark]")!;
    const name = screen.container.querySelector<HTMLElement>("[data-settings-about-name]")!;
    expect(mark.getAttribute("data-one-mark")).toBe("interactive");
    expect(mark.getBoundingClientRect().width).toBe(176);
    expect(Number.parseFloat(getComputedStyle(name).fontSize)).toBe(48);
    // The ring leads: above the name, and the pair is centered.
    expect(mark.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      name.getBoundingClientRect().top,
    );
    const hero = screen.container.querySelector<HTMLElement>("[data-settings-about-hero]")!;
    expect(hero.classList.contains("one-mark-host")).toBe(true);
    const centre = (element: HTMLElement) =>
      element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2;
    expect(Math.abs(centre(mark) - centre(name))).toBeLessThanOrEqual(1);
  });
});
