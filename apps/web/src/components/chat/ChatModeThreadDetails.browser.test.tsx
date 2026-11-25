import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { setWorkspaceMode } from "~/one/workspaceMode";

import { act, render } from "../../../test/render";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { PopoverCreateHandle } from "../ui/popover";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { resolveChatCanvasLayout } from "./chatCanvasLayout";
import { PanelLayoutControls } from "./PanelLayoutControls";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { useRightPanelActions } from "./useRightPanelActions";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread-chat-mode"),
};
const container = { width: 1200, height: 800 };
const placement = { x: 908, y: 0, right: 12, width: 280, height: 400 } as const;

const visibility = (presentation: "inline" | "popover") =>
  selectThreadPanelOpen(
    useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
    threadRef,
    presentation,
  );

/**
 * The header, the thread details card and the "Toggle thread details" command wired as the chat
 * view wires them, at a width where the canvas has room for the inline card.
 */
function ThreadHeader({ fixture }: { fixture: ReturnType<typeof setup> }) {
  const inlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "inline"),
  );
  const popoverOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "popover"),
  );
  const actions = useRightPanelActions({
    activeThreadRef: threadRef,
    activeProject: null,
    activeRightPanelSurface: null,
    activePreviewState: {
      snapshot: null,
      sessions: {},
      suppressedTabIds: new Set<string>(),
      activeTabId: null,
      desktopOverlay: null,
      desktopByTabId: {},
      recentlySeenUrls: [],
      listLoaded: false,
      serverEpoch: null,
      serverRevision: 0,
    },
    deviceState: {
      hosts: [],
      hostStatus: "disabled",
      hostStatuses: {},
      devices: [],
      sessions: [],
      onboardingCompleted: false,
      agentAccessEnabled: false,
      hubBasePath: "/api/device-hub",
      revision: 0,
    },
    deviceStateLoaded: false,
    pullRequestPanelTarget: null,
    threadPanelPresentation: "inline",
    isServerThread: true,
    embedded: false,
    diffAvailable: false,
    browserAvailable: false,
    canOperatePreview: false,
    diffOpen: false,
    previewPanelOpen: false,
    rightPanelOpen: false,
    canMaximizeRightPanel: false,
    rightPanelMaximized: false,
    supportsPullRequests: false,
    pullRequestsSurfaceAvailable: false,
    gitCwd: null,
    activeProjectCwd: null,
    onDiffPanelOpen: undefined,
    closeRightPanelSurface: () => {},
  });
  const toggleCommand = actions.shortcuts["threadPanel.toggle"];
  return (
    <ChatCanvasContext
      value={{
        container,
        lane: { padding: 48, minChatWidth: 640 },
        layout: resolveChatCanvasLayout({ container, preview: null }),
        previewKey: null,
        registerTimeline: () => {},
        measureDetailsCard: () => {},
        detailsCardTopInset: 0,
        preferredDetailsCard: placement,
        detailsCardPlacement: placement,
      }}
    >
      <div>
        <PanelLayoutControls
          showWorkspaceModeControls
          terminalAvailable={false}
          terminalOpen={false}
          terminalShortcutLabel={null}
          threadPanelOpen={inlineOpen}
          threadPanelPopoverOpen={popoverOpen}
          threadPanelPresentation="inline"
          threadPanelPopoverHandle={fixture.handle}
          threadPanelShortcutLabel="Shift+Cmd+B"
          rightPanelAvailable={false}
          rightPanelOpen={false}
          rightPanelShortcutLabel={null}
          onToggleTerminal={() => {}}
          onToggleThreadPanel={actions.toggleThreadPanelStable}
          onToggleRightPanel={() => {}}
        />
      </div>
      <button type="button" onClick={() => toggleCommand.run()}>
        Run toggle thread details command
      </button>
      <ThreadDetailsCard
        threadRef={threadRef}
        anchor={fixture.anchor}
        handle={fixture.handle}
        contentKey="1"
      >
        {() => <p>Details for the chat thread</p>}
      </ThreadDetailsCard>
    </ChatCanvasContext>
  );
}

function setup() {
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {} });
  setWorkspaceMode("code");
  const anchor = document.createElement("div");
  document.body.append(anchor);
  // The command asks the workspace to focus the card it opens.
  const original = window.matchMedia.bind(window);
  const motion = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? "not all" : query),
    );
  return {
    anchor: { current: anchor },
    handle: PopoverCreateHandle(),
    [Symbol.dispose]() {
      anchor.remove();
      motion.mockRestore();
      setWorkspaceMode("code");
    },
  };
}

const NO_ROUTER = { router: false /* the header does not navigate */ } as const;
const commandButton = () => page.getByRole("button", { name: "Run toggle thread details command" });
const headerControl = () => page.getByRole("button", { name: "Toggle thread details panel" });

it("in code mode the command opens the inline details card", async () => {
  using fixture = setup();
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", false);
  await using _screen = await render(<ThreadHeader fixture={fixture} />, NO_ROUTER);

  await commandButton().click();

  await expect.element(page.getByText("Details for the chat thread")).toBeVisible();
  expect(visibility("inline")).toBe(true);
  expect(visibility("popover")).toBe(false);
  expect(document.querySelector('[data-thread-details-panel="inline"]')).not.toBeNull();
});

it("in chat mode the command opens the details popover, and the header keeps a control for it", async () => {
  using fixture = setup();
  await using _screen = await render(<ThreadHeader fixture={fixture} />, NO_ROUTER);
  await act(() => setWorkspaceMode("chat"));
  await expect.element(headerControl()).toBeVisible();

  await commandButton().click();

  await expect.element(page.getByText("Details for the chat thread")).toBeVisible();
  expect(visibility("popover")).toBe(true);
  expect(document.querySelector('[data-thread-details-panel="inline"]')).toBeNull();
  expect(document.querySelector('[data-thread-details-panel="popover"]')).not.toBeNull();
});

it("in chat mode the header control opens and closes the details popover", async () => {
  using fixture = setup();
  await using _screen = await render(<ThreadHeader fixture={fixture} />, NO_ROUTER);
  await act(() => setWorkspaceMode("chat"));

  await headerControl().click();
  await expect.element(page.getByText("Details for the chat thread")).toBeVisible();
  expect(visibility("popover")).toBe(true);
  await expect.element(headerControl()).toHaveAttribute("aria-pressed", "true");

  await headerControl().click();
  await expect.element(page.getByText("Details for the chat thread")).not.toBeInTheDocument();
  expect(visibility("popover")).toBe(false);
});

it("in chat mode a card left open inline in code mode does not show, and the command still opens the popover", async () => {
  using fixture = setup();
  await using _screen = await render(<ThreadHeader fixture={fixture} />, NO_ROUTER);
  // The inline card is open by default.
  await expect.element(page.getByText("Details for the chat thread")).toBeVisible();

  await act(() => setWorkspaceMode("chat"));
  await expect.element(page.getByText("Details for the chat thread")).not.toBeInTheDocument();
  await commandButton().click();

  await expect.element(page.getByText("Details for the chat thread")).toBeVisible();
  expect(visibility("popover")).toBe(true);
  expect(document.querySelector('[data-thread-details-panel="inline"]')).toBeNull();
});
