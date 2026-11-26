import type { VcsDiscoveryItem } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { textContrast } from "../../../test/contrast";
import { render } from "../../../test/render";
import { DiscoveryItemRow } from "./SourceControlSettings";

const item = (overrides: Partial<VcsDiscoveryItem>): VcsDiscoveryItem => ({
  kind: "git",
  implemented: true,
  label: "Git",
  executable: "git",
  status: "available",
  version: Option.some("git version 2.56.1"),
  installHint: "Install Git.",
  detail: Option.none(),
  ...overrides,
});

describe("source control discovery row", () => {
  it("states a tool's status as one chip, with no dot over its logo and no dimmed switch", async () => {
    await using screen = await render(
      <div data-app-modal="" className="w-[880px]">
        <DiscoveryItemRow item={item({})} />
        <DiscoveryItemRow
          item={item({ kind: "jj", label: "Jujutsu", implemented: false, version: Option.none() })}
        />
      </div>,
      { router: false },
    );

    // The same chips every provider row uses: Ready for a tool that works, Coming soon for one that
    // is not built yet.
    await expect.element(screen.getByText("Ready", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Coming soon", { exact: true })).toBeVisible();
    expect(
      [...screen.container.querySelectorAll("[data-settings-status]")].map((chip) =>
        chip.getAttribute("data-settings-status"),
      ),
    ).toEqual(["ready", "soon"]);
    expect(screen.container.textContent).not.toContain("Coming Soon");
    expect(screen.container.querySelector('[role="switch"]')).toBeNull();
    expect(screen.container.querySelector("svg + span.rounded-full")).toBeNull();
    // The version is read like the rest of the row, not set in code type.
    expect(screen.container.querySelector("code")).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "draws a coming-soon tool's description at full strength, at least 4.5:1 in %s",
    async (scheme) => {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      document.body.style.backgroundColor =
        scheme === "dark" ? "rgb(10 10 10)" : "rgb(255 255 255)";
      try {
        await using screen = await render(
          <div data-app-modal="" className="w-[880px]">
            <DiscoveryItemRow
              item={item({
                kind: "jj",
                label: "Jujutsu",
                implemented: false,
                version: Option.none(),
              })}
            />
          </div>,
          { router: false },
        );
        const text = screen.getByText(/is coming soon/).element();
        expect(textContrast(text)).toBeGreaterThanOrEqual(4.5);
      } finally {
        document.body.style.removeProperty("background-color");
        document.documentElement.classList.remove("dark");
      }
    },
  );
});
