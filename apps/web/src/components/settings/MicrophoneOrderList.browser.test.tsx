import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { MicrophoneOrderList } from "./MicrophoneOrderList";

describe("MicrophoneOrderList", () => {
  it("offers reordering only when there is more than one microphone", async () => {
    await using single = await render(
      <MicrophoneOrderList order={[{ kind: "default" }]} devices={[]} />,
      {
        router: false,
      },
    );
    expect(single.container.querySelectorAll("button")).toHaveLength(0);
    expect(single.container.querySelector("svg.lucide-grip-vertical")).toBeNull();

    await using pair = await render(
      <MicrophoneOrderList
        order={[{ kind: "default" }, { kind: "device", deviceId: "usb", label: "USB mic" }]}
        devices={[]}
      />,
      { router: false },
    );
    await expect.element(pair.getByRole("button", { name: "Move USB mic up" })).toBeEnabled();
    await expect
      .element(pair.getByRole("button", { name: "Move System default down" }))
      .toBeEnabled();
  });
});
