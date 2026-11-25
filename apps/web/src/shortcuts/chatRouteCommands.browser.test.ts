import type { AnyRouter } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { isMacPlatform } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { installChatRouteCommands } from "./chatRouteCommands";
import { isCommandAvailable } from "./commandRegistry";
import { captureRunScope } from "./paletteRunScope";

// Every environment grants the preview, so what decides is whether the preview is open.
vi.mock(import("../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  readEnvironmentScope: (() => true) as never,
}));

type Match = { readonly routeId: string; readonly pathname: string };

function routerAt(matches: Match[]) {
  const state = { matches: matches.map((match) => ({ ...match, params: {} })) };
  return {
    router: { state } as unknown as AnyRouter,
    navigate: (next: Match[]) => {
      state.matches = next.map((match) => ({ ...match, params: {} }));
    },
  };
}

const CHAT: Match[] = [
  { routeId: "__root__", pathname: "/" },
  { routeId: "/_chat", pathname: "/" },
];

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

function pressMod(key: string): KeyboardEvent {
  const mac = isMacPlatform(navigator.platform);
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: mac,
    ctrlKey: !mac,
    cancelable: true,
    bubbles: true,
  });
  document.activeElement?.dispatchEvent(event);
  return event;
}

function selectThread(threadKey: string) {
  useThreadSelectionStore.getState().clearSelection();
  useThreadSelectionStore.getState().toggleThread(threadKey);
}

describe("chat route commands", () => {
  it("clears a selection made after install, reading the store at keypress time", () => {
    const { router } = routerAt(CHAT);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());

    selectThread("env:thread-1");
    const event = pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
    // With nothing selected, Escape is left for other handlers.
    expect(pressEscape().defaultPrevented).toBe(false);
  });

  it("stays out of the way off the chat route and under modal pages", () => {
    const { router, navigate } = routerAt([{ routeId: "__root__", pathname: "/pair" }]);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());
    selectThread("env:thread-1");

    expect(pressEscape().defaultPrevented).toBe(false);

    navigate([...CHAT, { routeId: "/_chat/settings", pathname: "/settings" }]);
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(1);

    navigate(CHAT);
    expect(pressEscape().defaultPrevented).toBe(true);
  });

  it("leaves zoom keys to the app unless the focused right panel shows a browser", () => {
    const { router } = routerAt(CHAT);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const panel = document.createElement("div");
    panel.setAttribute("data-preview-panel-mode", "inline");
    const pullRequestTab = document.createElement("button");
    panel.append(pullRequestTab);
    document.body.append(panel);
    stack.defer(() => panel.remove());
    pullRequestTab.focus();

    for (const key of ["=", "+", "-", "0"]) expect(pressMod(key).defaultPrevented).toBe(false);

    const browser = document.createElement("div");
    browser.setAttribute("data-preview-view", "");
    panel.append(browser);
    for (const key of ["=", "+", "-", "0"]) expect(pressMod(key).defaultPrevented).toBe(true);
  });

  it("offers the preview commands from a palette row only while the preview is showing", () => {
    const threadRef = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
    const router = {
      state: {
        matches: [
          { routeId: "__root__", pathname: "/", params: {} },
          {
            routeId: "/_chat",
            pathname: "/",
            params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
          },
        ],
      },
    } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useRightPanelStore.setState({ byThreadKey: {} }));
    const offered = () =>
      (["preview.refresh", "preview.focusUrl", "preview.find"] as const).map((command) =>
        isCommandAvailable(command),
      );

    expect(offered()).toEqual([false, false, false]);

    useRightPanelStore.getState().open(threadRef, "preview");
    expect(offered()).toEqual([true, true, true]);

    useRightPanelStore.getState().open(threadRef, "diff");
    expect(offered()).toEqual([false, false, false]);
  });

  it("offers the preview commands for an unsent draft whose preview is showing", () => {
    const environmentId = EnvironmentId.make("local");
    const draftId = DraftId.make("draft-preview");
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId({ environmentId, projectId: ProjectId.make("active") }, draftId);
    const draftThreadId = useComposerDraftStore.getState().getDraftSession(draftId)!.threadId;
    const router = {
      state: {
        matches: [
          { routeId: "__root__", pathname: "/", params: {} },
          { routeId: "/_chat", pathname: "/", params: {} },
          { routeId: "/_chat/draft/$draftId", pathname: `/draft/${draftId}`, params: { draftId } },
        ],
      },
    } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useComposerDraftStore.getState().clearDraftThread(draftId));
    stack.defer(() => useRightPanelStore.setState({ byThreadKey: {} }));
    const offered = () =>
      (["preview.refresh", "preview.focusUrl", "preview.find"] as const).map((command) =>
        isCommandAvailable(command),
      );

    expect(offered()).toEqual([false, false, false]);

    useRightPanelStore.getState().open(scopeThreadRef(environmentId, draftThreadId), "preview");
    expect(offered()).toEqual([true, true, true]);
  });

  it("ends a queued palette command's scope when its draft moves to another machine at the same address", () => {
    const projectId = ProjectId.make("active");
    const draftId = DraftId.make("draft-retarget");
    const drafts = useComposerDraftStore.getState();
    drafts.setProjectDraftThreadId(
      { environmentId: EnvironmentId.make("mac"), projectId },
      draftId,
    );
    const router = {
      state: {
        matches: [
          { routeId: "__root__", pathname: "/", params: {} },
          { routeId: "/_chat", pathname: "/", params: {} },
          { routeId: "/_chat/draft/$draftId", pathname: `/draft/${draftId}`, params: { draftId } },
        ],
      },
      history: { location: { href: `/draft/${draftId}` }, subscribe: () => () => {} },
      subscribe: () => () => {},
    } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useComposerDraftStore.getState().clearDraftThread(draftId));

    const untouched = captureRunScope();
    stack.defer(untouched.dispose);
    expect(untouched.isValid()).toBe(true);

    const queued = captureRunScope();
    stack.defer(queued.dispose);
    // Auto balance picks the other machine: the address and the draft id stay as they were.
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId({ environmentId: EnvironmentId.make("linux"), projectId }, draftId);

    expect(useComposerDraftStore.getState().getDraftSession(draftId)?.environmentId).toBe("linux");
    expect(queued.isValid()).toBe(false);
  });
});
