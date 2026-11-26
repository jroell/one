import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

vi.mock(import("~/state/presentation"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const actual = await original();
  return {
    ...actual,
    environmentPresentations: {
      ...actual.environmentPresentations,
      presentationsAtom: Atom.make(new Map()) as never,
    },
  };
});
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));

import { UsagePriceOverrides } from "./UsagePriceOverrides";

it("offers to add an environment where model prices need one, and closes the dialog to go there", async () => {
  const onOpenChange = vi.fn();
  await using screen = await render(
    <UsagePriceOverrides
      usage={[]}
      initialSelectedEnvironmentIds={null}
      onOpenChange={onOpenChange}
    />,
    { router: "/usage" },
  );

  await expect.element(page.getByText("Connect an environment to set model prices.")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Add an environment" }));

  expect(onOpenChange).toHaveBeenCalledWith(false);
  await vi.waitFor(() =>
    expect(screen.router!.state.location.pathname).toBe("/settings/connections"),
  );
});
