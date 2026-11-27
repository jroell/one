import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useShellArriving } from "./useShellArriving";

let awaitingShell = true;

vi.mock("../../state/entities", () => ({
  useAnyEnvironmentAwaitingShell: () => awaitingShell,
  useQuietThreadShellsLagging: () => false,
}));

function Probe() {
  const arriving = useShellArriving(60);
  const [, rerender] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          awaitingShell = !awaitingShell;
          rerender((n) => n + 1);
        }}
      >
        toggle
      </button>
      <span data-testid="arriving">{arriving ? "arriving" : "settled"}</span>
    </>
  );
}

describe("the sidebar's wait for thread shells", () => {
  it("gives up after one long wait, and waits again when a later snapshot is awaited", async () => {
    awaitingShell = true;
    await using screen = await render(<Probe />, { router: false });
    const arriving = page.getByTestId("arriving");
    await expect.element(arriving).toHaveTextContent("arriving");
    await expect.element(arriving).toHaveTextContent("settled");

    await page.getByRole("button", { name: "toggle" }).click();
    await expect.element(arriving).toHaveTextContent("settled");
    await page.getByRole("button", { name: "toggle" }).click();

    expect(screen.container.querySelector("[data-testid=arriving]")?.textContent).toBe("arriving");
    await expect.element(arriving).toHaveTextContent("settled");
  });
});
