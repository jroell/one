import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

interface AskOneSheetState {
  /** Whether the sheet is showing (or leaving). Its content stays until the exit has finished. */
  readonly open: boolean;
  /** The sheet's title; translated by the caller. */
  readonly title: string;
  /** The person's question, shown with a working arc until the conversation's own thread is in. */
  readonly question: string | null;
  /** The conversation; null until the server thread exists. */
  readonly thread: ScopedThreadRef | null;
  /** Opens at once with the question, before there is a thread. */
  readonly begin: (input: { readonly title: string; readonly question: string }) => void;
  /** The thread that now holds the conversation. */
  readonly attach: (thread: ScopedThreadRef) => void;
  /** Opens an existing conversation. */
  readonly show: (input: { readonly title: string; readonly thread: ScopedThreadRef }) => void;
  readonly close: () => void;
  /** Empties the sheet once it has left the screen. */
  readonly reset: () => void;
}

export const useAskOneSheetStore = create<AskOneSheetState>((set) => ({
  open: false,
  title: "",
  question: null,
  thread: null,
  begin: ({ title, question }) => set({ open: true, title, question, thread: null }),
  attach: (thread) => set({ thread }),
  show: ({ title, thread }) => set({ open: true, title, question: null, thread }),
  close: () => set({ open: false }),
  reset: () => set({ title: "", question: null, thread: null }),
}));
