import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../test/render";
import { useAskOneSheetStore } from "./askOneSheetStore";
import { GuidedBridgeScopeContext } from "./guidedBridgeScope";
import { GuidedThreadFooter } from "./GuidedThreadFooter";

const info = {
  asked: "Claude",
  actions: [{ label: "Open Projects", href: "/settings/projects" }],
};

async function clickLink(scope: "main" | "sheet") {
  await using screen = await render(
    <GuidedBridgeScopeContext value={scope}>
      <GuidedThreadFooter info={info} answered timestampFormat="locale" />
    </GuidedBridgeScopeContext>,
  );
  const navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
  useAskOneSheetStore.getState().begin({ title: "Usage providers", question: "What is this?" });
  const link = screen.container.querySelector<HTMLButtonElement>(".one-guided-link")!;
  await act(() => link.click());
  const closed = !useAskOneSheetStore.getState().open;
  useAskOneSheetStore.getState().reset();
  return { navigate, closed };
}

it("a link in the Ask One sheet closes the sheet and opens the place it names", async () => {
  const { navigate, closed } = await clickLink("sheet");
  expect(navigate).toHaveBeenCalledWith({ href: "/settings/projects" });
  expect(closed).toBe(true);
});

it("a link in a thread's own view opens the place it names and leaves the sheet alone", async () => {
  const { navigate, closed } = await clickLink("main");
  expect(navigate).toHaveBeenCalledWith({ href: "/settings/projects" });
  expect(closed).toBe(false);
});
