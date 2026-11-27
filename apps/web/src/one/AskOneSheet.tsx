import { T, useGT } from "gt-react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState } from "react";

import ChatView from "~/components/ChatView";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
import { Button } from "~/components/ui/button";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "~/components/ui/sheet";
import { ComposerHandleContext } from "~/composerHandleContext";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { buildThreadRouteParams } from "~/threadRoutes";

import { useAskOneSheetStore } from "./askOneSheetStore";
import { GuidedBridgeScopeContext } from "./guidedBridgeScope";
import { setWorkspaceMode } from "./workspaceMode";
import { WorkingArc } from "./WorkingArc";

const NO_PANEL_ACTION = () => {};

/** How long the docked sheet takes to leave: the sheet motion times the exit factor, in ms. */
function sheetExitMs(): number {
  const root = getComputedStyle(document.documentElement);
  const sheet = Number.parseFloat(root.getPropertyValue("--mo-sheet"));
  const exit = Number.parseFloat(root.getPropertyValue("--mo-exit"));
  return (Number.isFinite(sheet) ? sheet : 320) * (Number.isFinite(exit) ? exit : 0.7);
}

/**
 * Reserves the page's gutter from the sheet's first frame until its exit has finished, so no frame
 * shows a gap beside the sheet and the page moves once, under it, as it goes.
 */
function ReserveGutter({ open }: { readonly open: boolean }) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks the document for the sheet's time on screen, and releases it when the exit ends, so the page behind can move over (one-chat.css)
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (open) {
      root.dataset.askOneSheet = "";
      return;
    }
    const timer = setTimeout(() => delete root.dataset.askOneSheet, sheetExitMs());
    return () => clearTimeout(timer);
  }, [open]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- never leaves the document marked when the sheet is torn down
  useLayoutEffect(() => () => void delete document.documentElement.dataset.askOneSheet, []);
  return null;
}

/**
 * The question and the working arc, from the sheet's first frame until the thread has a message
 * of its own: the sheet is never empty, and the hand-over does not flash.
 */
function PendingQuestion({
  question,
  done,
}: {
  readonly question: string;
  readonly done: boolean;
}) {
  const gt = useGT();
  return (
    <div
      aria-hidden={done}
      data-ask-one-pending=""
      data-done={done ? "" : undefined}
      className="absolute inset-x-0 top-0 bottom-36 z-10 flex flex-col gap-6 overflow-hidden bg-popover ps-6 pe-16 pt-12 transition-opacity duration-(--mo-quick) ease-(--ease-enter) data-done:pointer-events-none data-done:opacity-0"
    >
      <div className="ms-auto max-w-54" data-user-message-bubble="">
        {question}
      </div>
      <div className="one-chat-stage-live" role={done ? undefined : "status"}>
        <WorkingArc size={32} />
        <span className="one-chat-stage-caption">{gt("Thinking")}</span>
      </div>
    </div>
  );
}

/** Whether the conversation under `root` shows the answer taking shape: its own stage or an answer. */
function useConversationShowing(root: HTMLElement | null): boolean {
  const [has, setHas] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the embedded conversation's DOM for its first message row, which nothing in this tree announces
  useEffect(() => {
    if (root === null) return;
    const look = () =>
      setHas(
        root.querySelector('[data-chat-stage][data-shown], [data-message-role="assistant"]') !==
          null,
      );
    look();
    const observer = new MutationObserver(look);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
  return has;
}

/**
 * Where "Ask One about this" answers over Settings and Usage: a sheet beside the page, opened with
 * the question already showing. Escape or the close button returns to the page, and "Open as a
 * thread" moves the conversation to the full Chat view.
 */
export function AskOneSheetHost() {
  const gt = useGT();
  const { open, title, question, thread } = useAskOneSheetStore();
  const close = useAskOneSheetStore((state) => state.close);
  const reset = useAskOneSheetStore((state) => state.reset);
  const router = useRouter();
  const [conversation, setConversation] = useState<HTMLDivElement | null>(null);
  const showing = useConversationShowing(conversation);
  const openAsThread = () => {
    if (thread === null) return;
    setWorkspaceMode("chat");
    close();
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(thread),
    });
  };
  const panel: SideChatParentPanel | null =
    thread === null
      ? null
      : { hostRef: thread, openToolDiff: NO_PANEL_ACTION, runShellCommand: NO_PANEL_ACTION };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      onOpenChangeComplete={(next) => (next ? undefined : reset())}
    >
      <SheetPopup
        side="right"
        variant="docked"
        aboveDialogs
        scrim={false}
        className="h-full max-w-[26.25rem]"
        data-ask-one-sheet=""
      >
        <ReserveGutter open={open} />
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              <T>Ask One</T>
            </p>
            <SheetTitle>{title}</SheetTitle>
            <div>
              <Button variant="outline" size="sm" disabled={thread === null} onClick={openAsThread}>
                <T>Open as a thread</T>
              </Button>
            </div>
          </SheetHeader>
          <div ref={setConversation} className="relative flex min-h-0 flex-1 flex-col">
            {thread !== null && panel !== null ? (
              <BackgroundThreadContext value>
                <ComposerHandleContext value={null}>
                  <GuidedBridgeScopeContext value="sheet">
                    <ChatView
                      key={thread.threadId}
                      environmentId={thread.environmentId}
                      threadId={thread.threadId}
                      routeKind="server"
                      embedded={panel}
                    />
                  </GuidedBridgeScopeContext>
                </ComposerHandleContext>
              </BackgroundThreadContext>
            ) : (
              <div
                aria-hidden
                className="mx-4 mt-auto mb-4 rounded-3xl border bg-background/60 px-4 py-3 text-muted-foreground"
                style={{ minHeight: "5.5rem" }}
              >
                {gt("Ask anything, or talk it through")}
              </div>
            )}
            {question !== null ? (
              <PendingQuestion question={question} done={thread !== null && showing} />
            ) : null}
          </div>
        </div>
      </SheetPopup>
    </Sheet>
  );
}
