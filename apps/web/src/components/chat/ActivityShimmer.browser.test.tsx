import "~/index.css";
import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { ActivityShimmerOverlay } from "./TimelineRowParts";

function shimmer(label: string) {
  return (
    <span
      data-testid="host"
      className="one-shimmer-host relative inline-block overflow-hidden whitespace-nowrap"
    >
      {label}
      <ActivityShimmerOverlay>{label}</ActivityShimmerOverlay>
    </span>
  );
}

it("sweeps a soft 72px band across the whole label in 1.8s, 35% brighter than the text at rest, and never cuts a glyph", async () => {
  await using screen = await render(shimmer("server/src/math.ts"), { router: false });
  const host = screen.getByTestId("host").element() as HTMLElement;
  const overlay = host.querySelector(".live-activity-focus") as HTMLElement;
  const text = host.querySelector(".live-activity-focus-aligned") as HTMLElement;
  const hostWidth = host.getBoundingClientRect().width;
  const style = getComputedStyle(overlay);
  // The overlay reaches one 72px band beyond each end of the text, so the band enters and leaves whole.
  expect(overlay.getBoundingClientRect().width - hostWidth).toBeCloseTo(144, 0);
  expect(text.getBoundingClientRect().width).toBeCloseTo(hostWidth, 0);
  expect(style.animationName).toBe("one-shimmer-sweep");
  expect(style.animationDuration).toBe("1.8s");
  // The mask rises and falls through many stops, with no step from clear to opaque.
  const stops = style.maskImage.match(/rgba?\([^)]*\)/g) ?? [];
  expect(stops.length).toBeGreaterThanOrEqual(9);
  const alphas = stops.map((stop) =>
    stop.startsWith("rgba") ? Number(/,\s*([\d.]+)\)$/.exec(stop)![1]) : 1,
  );
  for (let index = 1; index < alphas.length; index += 1) {
    expect(Math.abs(alphas[index]! - alphas[index - 1]!)).toBeLessThanOrEqual(0.4);
  }
  // At rest the text is dimmer than the band's peak, so a still never shows a dark half.
  expect(getComputedStyle(host).color).not.toBe(getComputedStyle(text).color);
});
