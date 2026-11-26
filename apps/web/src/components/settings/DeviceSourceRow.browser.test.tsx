import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { DeviceToolVersions } from "../device/DeviceToolVersions";
import { DeviceSourceRow } from "./DeviceSourcesSettings";
import { SettingsRow } from "./settingsLayout";

type Row = Parameters<typeof DeviceSourceRow>[0]["row"];

const description = "Simulators and emulators installed on this environment's machine.";
const local = (platforms?: NonNullable<Row["environments"][number]["platforms"]>): Row => ({
  key: "local",
  shared: false,
  title: "Local simulators",
  description,
  environments: [
    { environmentId: EnvironmentId.make("local"), label: "Mac", added: true, platforms },
  ],
});

const gap = (root: Element) => {
  const title = root.querySelector("[data-settings-row-title]")!.getBoundingClientRect();
  const text = root.querySelector("[data-settings-row-description]")!.getBoundingClientRect();
  return text.top - title.top;
};

describe("device source row", () => {
  it("spaces its title and description like every other settings row, at the same row height", async () => {
    await using screen = await render(
      <div className="w-[880px]">
        <div data-testid="shared">
          <SettingsRow title="Use devices" description={description} />
        </div>
        <div data-testid="source">
          <DeviceSourceRow row={local()} />
        </div>
      </div>,
      { router: false },
    );
    const shared = screen.container.querySelector('[data-testid="shared"]')!;
    const source = screen.container.querySelector('[data-testid="source"]')!;
    expect(gap(source)).toBeCloseTo(gap(shared), 0);
    expect(source.firstElementChild!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      shared.firstElementChild!.getBoundingClientRect().height,
    );
  });

  it("says nothing has been checked until a platform is reported, then shows the platforms instead", async () => {
    const check = vi.fn();
    await using unreported = await render(<DeviceSourceRow row={{ ...local(), check }} />, {
      router: false,
    });
    await expect.element(page.getByText(/Not checked yet/)).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Check now" }));
    expect(check).toHaveBeenCalledOnce();
    await unreported.unmount();

    await using reported = await render(
      <DeviceSourceRow row={local([{ platform: "ios", available: true }])} />,
      { router: false },
    );
    expect(reported.container.textContent).not.toContain("Not checked yet");
    await expect
      .element(reported.getByRole("button", { name: "Local simulators: iOS available" }))
      .toBeVisible();
  });

  it("sets a tool version in the weight and color of the sentence it ends", async () => {
    await using screen = await render(
      <div data-app-modal="" className="w-[880px]">
        <SettingsRow
          title="Use devices"
          description={
            <>
              Open simulators. Hub:{" "}
              <DeviceToolVersions
                kind="hub"
                tools={
                  {
                    hub: {
                      runningVersion: "0.22.1",
                      installedVersions: ["0.22.1"],
                      requiredVersion: "0.22.1",
                    },
                  } as never
                }
              />
            </>
          }
        />
      </div>,
      { router: false },
    );
    const sentence = screen.container.querySelector("[data-settings-row-description]")!;
    const version = screen.getByRole("button", { name: /version 0\.22\.1/ }).element();
    expect(getComputedStyle(version).fontWeight).toBe(getComputedStyle(sentence).fontWeight);
    expect(getComputedStyle(version).color).toBe(getComputedStyle(sentence).color);
  });
});
