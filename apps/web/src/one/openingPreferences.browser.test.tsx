import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { setOpeningPreferences, useOpeningPreferences } from "./openingPreferences";

function Probe() {
  const { animation, sound } = useOpeningPreferences();
  return (
    <output>
      animation {animation ? "on" : "off"}, sound {sound ? "on" : "off"}
    </output>
  );
}

function resetPreferences() {
  return {
    [Symbol.dispose]() {
      setOpeningPreferences({ animation: true, sound: true });
    },
  };
}

it("keeps the session's opening choice when the settings rows mount again with storage blocked", async () => {
  using _reset = resetPreferences();
  using _read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage is blocked", "SecurityError");
  });
  using _write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage is blocked", "SecurityError");
  });
  setOpeningPreferences({ animation: false });

  {
    await using first = await render(<Probe />, { router: false });
    await expect.element(first.getByRole("status")).toHaveTextContent("animation off, sound on");
  }
  await using second = await render(<Probe />, { router: false });

  await expect.element(second.getByRole("status")).toHaveTextContent("animation off, sound on");
});

it("reads a choice another window saved while this one was not listening", async () => {
  using _reset = resetPreferences();
  window.localStorage.setItem("one:opening-sound", "off");
  onTestFinished(() => window.localStorage.removeItem("one:opening-sound"));

  await using screen = await render(<Probe />, { router: false });

  await expect.element(screen.getByRole("status")).toHaveTextContent("animation on, sound off");
});
