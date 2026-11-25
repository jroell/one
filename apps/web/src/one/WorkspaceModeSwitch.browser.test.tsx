import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { WorkspaceModeSwitch } from "./WorkspaceModeSwitch";
import { setWorkspaceMode } from "./workspaceMode";

function setup() {
  setWorkspaceMode("code");
  return {
    [Symbol.dispose]() {
      setWorkspaceMode("code");
    },
  };
}

const NO_ROUTER = { router: false /* the switch does not navigate */ } as const;

it("the workspace switch changes the page to chat mode and back", async () => {
  using _mode = setup();
  await using screen = await render(<WorkspaceModeSwitch />, NO_ROUTER);

  await screen.getByRole("radio", { name: "Chat" }).click();
  await expect.element(screen.getByRole("radio", { name: "Chat" })).toBeChecked();
  await expect.poll(() => document.documentElement.dataset.oneMode).toBe("chat");

  await screen.getByRole("radio", { name: "Code" }).click();
  await expect.element(screen.getByRole("radio", { name: "Code" })).toBeChecked();
  await expect.poll(() => document.documentElement.dataset.oneMode).toBe("code");
});

it("the workspace switch moves with the arrow keys and keeps focus on the chosen mode", async () => {
  using _mode = setup();
  await using screen = await render(<WorkspaceModeSwitch />, NO_ROUTER);

  screen.getByRole("radio", { name: "Code" }).element().focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(screen.getByRole("radio", { name: "Chat" })).toBeChecked();
  await expect.element(screen.getByRole("radio", { name: "Chat" })).toHaveFocus();
});

it("choosing chat and then code before the page has updated ends in code mode", async () => {
  using _mode = setup();
  await using screen = await render(<WorkspaceModeSwitch />, NO_ROUTER);

  setWorkspaceMode("chat");
  setWorkspaceMode("code");

  await expect.element(screen.getByRole("radio", { name: "Code" })).toBeChecked();
  await expect.poll(() => document.documentElement.dataset.oneMode).toBe("code");
});

it("switching to chat while focus is inside the inline thread details card moves focus to the switch", async () => {
  using _mode = setup();
  await using screen = await render(
    <>
      <WorkspaceModeSwitch />
      <aside data-thread-details-panel="inline">
        <button type="button">Branch</button>
      </aside>
    </>,
    NO_ROUTER,
  );
  screen.getByRole("button", { name: "Branch" }).element().focus();

  await act(() => setWorkspaceMode("chat"));

  await expect.element(screen.getByRole("radio", { name: "Chat" })).toHaveFocus();
});

it("switching to chat leaves focus where it is when it is outside the thread details card", async () => {
  using _mode = setup();
  await using screen = await render(
    <>
      <WorkspaceModeSwitch />
      <button type="button">Elsewhere</button>
    </>,
    NO_ROUTER,
  );
  screen.getByRole("button", { name: "Elsewhere" }).element().focus();

  await act(() => setWorkspaceMode("chat"));

  await expect.element(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
});
