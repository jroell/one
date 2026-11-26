import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { SidebarProvider, useSidebar } from "~/components/ui/sidebar";
import { render } from "../../test/render";
import { ModeSidebar } from "./chatSidebar";
import { setWorkspaceMode } from "./workspaceMode";

function Probe() {
  const { open, setOpen } = useSidebar();
  return (
    <>
      <output data-testid="sidebar">{open ? "open" : "collapsed"}</output>
      <button type="button" onClick={() => setOpen(!open)}>
        Toggle sidebar
      </button>
    </>
  );
}

function Scene() {
  return (
    <SidebarProvider storageKey="test_sidebar_open">
      <ModeSidebar />
      <Probe />
    </SidebarProvider>
  );
}

function clearStorage() {
  for (const key of [
    "one:sidebar-open:chat",
    "one:sidebar-open:code",
    "test_sidebar_open",
    "one:workspace-mode",
  ]) {
    window.localStorage.removeItem(key);
  }
}

it("Chat mode starts with the sidebar collapsed on a wide screen, Code keeps its own, and the person's own choice in a mode wins from then on", async () => {
  clearStorage();
  setWorkspaceMode("code");
  await page.viewport(1440, 900);
  const state = () => page.getByTestId("sidebar");
  try {
    await using screen = await render(<Scene />, { router: false });
    await expect.element(state()).toHaveTextContent("open");

    setWorkspaceMode("chat");
    await expect.element(state()).toHaveTextContent("collapsed");

    // The person opens it in Chat: Chat remembers that, and Code is untouched.
    await screen.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect.element(state()).toHaveTextContent("open");
    setWorkspaceMode("code");
    await expect.element(state()).toHaveTextContent("open");
    await screen.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect.element(state()).toHaveTextContent("collapsed");

    // Back in Chat, the choice made there still stands (open); Code's own choice (collapsed) too.
    setWorkspaceMode("chat");
    await expect.element(state()).toHaveTextContent("open");
    setWorkspaceMode("code");
    await expect.element(state()).toHaveTextContent("collapsed");
  } finally {
    clearStorage();
    setWorkspaceMode("code");
  }
});

it("Chat mode leaves the sidebar alone on a narrow screen", async () => {
  clearStorage();
  setWorkspaceMode("code");
  await page.viewport(1000, 900);
  try {
    await using screen = await render(<Scene />, { router: false });
    setWorkspaceMode("chat");
    await expect.element(page.getByTestId("sidebar")).toHaveTextContent("open");
    await screen.rerender(<Scene />);
  } finally {
    clearStorage();
    setWorkspaceMode("code");
    await page.viewport(1440, 900);
  }
});
