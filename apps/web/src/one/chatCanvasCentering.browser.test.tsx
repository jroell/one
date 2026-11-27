import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { ChatCanvas } from "~/components/chat/ChatCanvas";
import { createChatCanvasStore } from "~/components/chat/canvasStore";
import { ThreadDetailsCard } from "~/components/chat/ThreadDetailsCard";
import { PopoverCreateHandle } from "~/components/ui/popover";
import { useRightPanelStore } from "~/rightPanelStore";
import { act, render } from "../../test/render";
import { setWorkspaceMode } from "./workspaceMode";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread-centering"),
};

function Canvas({ anchor }: { anchor: HTMLElement }) {
  const [store] = useState(createChatCanvasStore);
  const [handle] = useState(PopoverCreateHandle);
  return (
    <ChatCanvas
      store={store}
      threadRef={threadRef}
      preview={null}
      composerOverlayElement={null}
      rightPanelOpen={false}
      data-testid="canvas"
    >
      <ThreadDetailsCard
        threadRef={threadRef}
        anchor={{ current: anchor }}
        handle={handle}
        contentKey="1"
      >
        {() => <p style={{ height: 200 }}>Details for the thread</p>}
      </ThreadDetailsCard>
    </ChatCanvas>
  );
}

const insets = () => {
  const canvas = document.querySelector<HTMLElement>("[data-chat-canvas]")!;
  const style = getComputedStyle(canvas);
  return {
    start: Number.parseFloat(style.getPropertyValue("--chat-lane-inset-start")),
    end: Number.parseFloat(style.getPropertyValue("--chat-lane-inset-end")),
  };
};

it("the reading column sits centered after a trip from code mode to chat mode with the details card open", async () => {
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {} });
  setWorkspaceMode("code");
  const anchor = document.createElement("div");
  document.body.append(anchor);
  const original = window.matchMedia.bind(window);
  using _motion = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? "not all" : query),
    );
  const container = document.createElement("div");
  container.style.cssText = "width: 1100px; height: 700px; display: flex; flex-direction: column;";
  await using _screen = await render(<Canvas anchor={anchor} />, { container, router: false });

  // The open inline card takes room from the right of the column.
  await vi.waitFor(() => expect(insets().end).toBeGreaterThan(insets().start));
  await expect.element(page.getByText("Details for the thread")).toBeVisible();

  await act(() => setWorkspaceMode("chat"));
  await expect.element(page.getByText("Details for the thread")).not.toBeInTheDocument();
  await vi.waitFor(() => expect(insets().end).toBe(insets().start));

  await act(() => setWorkspaceMode("code"));
  await vi.waitFor(() => expect(insets().end).toBeGreaterThan(insets().start));
  anchor.remove();
  setWorkspaceMode("code");
});
