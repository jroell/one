import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { getWorkspaceMode, setWorkspaceMode, type WorkspaceMode } from "./workspaceMode";

interface AskOneSheetState {
  /** Whether the sheet is showing (or leaving). Its content stays until the exit has finished. */
  readonly open: boolean;
  /** The sheet's title; translated by the caller. */
  readonly title: string;
  /** The person's question, shown with a working arc until the conversation's own thread is in. */
  readonly question: string | null;
  /** The conversation; null until the server thread exists. */
  readonly thread: ScopedThreadRef | null;
  /** Numbers each opening, so a flow that outlives its sheet cannot act on the next one. */
  readonly generation: number;
  /** The mode to give back when the sheet has left, set only when the sheet changed it. */
  readonly modeBefore: WorkspaceMode | null;
  /** Opens at once with the question, before there is a thread. Returns the opening's number. */
  readonly begin: (input: { readonly title: string; readonly question: string }) => number;
  /** Whether the opening `generation` is still the one on screen, not closed or replaced. */
  readonly isLive: (generation: number) => boolean;
  /** The thread that now holds the conversation. Ignored once its opening is closed or replaced. */
  readonly attach: (generation: number, thread: ScopedThreadRef) => void;
  /** Opens an existing conversation. */
  readonly show: (input: { readonly title: string; readonly thread: ScopedThreadRef }) => number;
  /** Closes the sheet. With a `generation`, only if that opening is still the current one. */
  readonly close: (generation?: number) => void;
  /** Switches the workspace to Chat for the sheet's conversation and remembers the mode to restore. */
  readonly enterChatMode: () => void;
  /** Leaves the workspace mode as it is when the sheet has gone, for "Open as a thread". */
  readonly keepMode: () => void;
  /** Empties the sheet once it has left the screen, and gives the earlier mode back. */
  readonly reset: () => void;
}

export const useAskOneSheetStore = create<AskOneSheetState>((set, get) => ({
  open: false,
  title: "",
  question: null,
  thread: null,
  generation: 0,
  modeBefore: null,
  begin: ({ title, question }) => {
    const generation = get().generation + 1;
    set({ open: true, title, question, thread: null, generation });
    return generation;
  },
  isLive: (generation) => get().open && get().generation === generation,
  attach: (generation, thread) => {
    if (get().isLive(generation)) set({ thread });
  },
  show: ({ title, thread }) => {
    const generation = get().generation + 1;
    set({ open: true, title, question: null, thread, generation });
    return generation;
  },
  close: (generation) => {
    if (generation !== undefined && get().generation !== generation) return;
    set({ open: false });
  },
  enterChatMode: () => {
    if (get().modeBefore === null && getWorkspaceMode() !== "chat") {
      set({ modeBefore: getWorkspaceMode() });
    }
    setWorkspaceMode("chat");
  },
  keepMode: () => set({ modeBefore: null }),
  reset: () => {
    const { open, modeBefore } = get();
    // A new question can open the sheet while the last one is still leaving.
    if (open) return;
    if (modeBefore !== null && getWorkspaceMode() === "chat") setWorkspaceMode(modeBefore);
    set({ title: "", question: null, thread: null, modeBefore: null });
  },
}));
