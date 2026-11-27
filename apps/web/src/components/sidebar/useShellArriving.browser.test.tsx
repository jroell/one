import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useShellArriving } from "./useShellArriving";

let awaitingShell = true;
// Long enough that a slow click on a loaded machine still sees the wait before it gives up.
const LIMIT_MS = 1_500;

vi.mock("../../state/entities", () => ({
  useAnyEnvironmentAwaitingShell: () => awaitingShell,
  useQuietThreadShellsLagging: () => false,
}));

function Probe() {
  const arriving = useShellArriving(LIMIT_MS);
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
    await using _screen = await render(<Probe />, { router: false });
    const arriving = page.getByTestId("arriving");
    await expect.element(arriving).toHaveTextContent("arriving");
    await expect.element(arriving, { timeout: LIMIT_MS * 3 }).toHaveTextContent("settled");

    await page.getByRole("button", { name: "toggle" }).click();
    await expect.element(arriving).toHaveTextContent("settled");
    await page.getByRole("button", { name: "toggle" }).click();

    await expect.element(arriving).toHaveTextContent("arriving");
    await expect.element(arriving, { timeout: LIMIT_MS * 3 }).toHaveTextContent("settled");
  });
});
