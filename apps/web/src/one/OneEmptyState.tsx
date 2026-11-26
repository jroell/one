import { T, useGT } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { KeybindingCommand } from "@t3tools/contracts";
import { createContext, use, type ReactNode } from "react";
import {
  AudioLinesIcon,
  AtSignIcon,
  CircleHelpIcon,
  FileDiffIcon,
  FileTextIcon,
  FileSearchIcon,
  GraduationCapIcon,
  LightbulbIcon,
  ScaleIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";

import { dispatchCommandPalette } from "~/commandPaletteStore";
import { Kbd } from "~/components/ui/kbd";
import { useComposerHandleContext } from "~/composerHandleContext";
import { useNowMinute } from "~/hooks/useNowMinute";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useProject, useThreadShell } from "~/state/entities";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { OneOrb } from "./OneOrb";
import { useVoiceBridge } from "./voiceBridge";
import { startVoiceChat } from "./startVoiceChat";
import { useVoiceSession } from "./voiceSession";
import { useWorkspaceMode } from "./workspaceMode";
import { toastManager } from "~/components/ui/toast";

function greetingFor(hour: number, gt: ReturnType<typeof useGT>): string {
  if (hour < 5) return gt("Still up?");
  if (hour < 12) return gt("Good morning");
  if (hour < 18) return gt("Good afternoon");
  return gt("Good evening");
}

/**
 * True inside the main conversation, the only place whose composer the welcome
 * can fill and whose thread voice chat can join. Linked, side and read-only
 * timelines get the plain placeholder.
 */
export const MainConversationContext = createContext(false);

/** A new thread's headline, naming its project, when the draft docks its composer. */
export const DraftHeadingContext = createContext<ReactNode>(null);

/**
 * The conversation's own way of opening the diff panel, with whether it can: a plain folder
 * with no repository has no diff, and the thread's regular control says so. Absent outside it.
 */
export const ReviewChangesContext = createContext<{
  readonly available: boolean;
  readonly open: () => void;
} | null>(null);

/** Shown in a thread with no messages yet. */
export function OneEmptyState() {
  const mode = useWorkspaceMode();
  const mainConversation = use(MainConversationContext);
  const draftHeading = use(DraftHeadingContext);
  if (mode === "chat" && mainConversation) return <ChatWelcome />;
  if (mainConversation) return <CodeWelcome {...(draftHeading ? { heading: draftHeading } : {})} />;
  return (
    <p className="text-center text-sm text-muted-foreground">
      <T>Send a message to start the conversation.</T>
    </p>
  );
}

/** The ring the welcomes share. Voice chat draws its own over the screen; two live rings cost twice. */
function WelcomeOrb() {
  const voiceOpen = useVoiceSession().stage !== "off";
  return voiceOpen ? (
    <div className="one-chat-welcome-orb aspect-square" />
  ) : (
    <OneOrb className="one-chat-welcome-orb" />
  );
}

interface CodeStarter {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  /** The keybinding command whose shortcut is shown, when the action has one. */
  readonly command: KeybindingCommand | null;
  /** Shown when the action has no binding of its own. */
  readonly keycap?: string;
  readonly run: () => void;
}

/**
 * The code mode welcome: a greeting, the project, and things to do first. A new thread's draft
 * passes its own `heading`, which names the project as a picker and offers to start without one.
 */
export function CodeWelcome({ heading }: { readonly heading?: ReactNode } = {}) {
  const gt = useGT();
  const composer = useComposerHandleContext();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const target = resolveThreadRouteTarget(params);
  const threadRef = target?.kind === "server" ? target.threadRef : null;
  const review = use(ReviewChangesContext);
  const shell = useThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);

  const starters: ReadonlyArray<CodeStarter> = [
    {
      id: "mention",
      icon: AtSignIcon,
      label: gt("Mention a file"),
      command: null,
      keycap: "@",
      run: () => {
        const handle = composer?.current;
        if (!handle) return;
        const empty = handle.readSnapshot().value.trim().length === 0;
        if (empty) handle.insertTextAtEnd("@");
        handle.focusAtEnd();
      },
    },
    {
      id: "search",
      icon: FileSearchIcon,
      label: gt("Search the project"),
      command: "projectSearch.toggle",
      run: () => dispatchCommandPalette({ _tag: "ToggleMode", mode: "content" }),
    },
    // The third starter is the diff when the thread has one, else a file: the set is always four.
    review?.available
      ? {
          id: "changes",
          icon: FileDiffIcon,
          label: gt("Review changes"),
          command: "diff.toggle",
          run: review.open,
        }
      : {
          id: "open-file",
          icon: FileTextIcon,
          label: gt("Open a file"),
          command: "filePicker.toggle",
          run: () => dispatchCommandPalette({ _tag: "ToggleMode", mode: "files" }),
        },
    {
      id: "palette",
      icon: SquareTerminalIcon,
      label: gt("Command palette"),
      command: "commandPalette.toggle",
      run: () => dispatchCommandPalette({ _tag: "SetOpen", open: true }),
    },
  ];

  return (
    <div
      className="one-chat-welcome"
      data-one-code-welcome=""
      {...(heading === undefined ? {} : { "data-draft": "" })}
    >
      <WelcomeOrb />
      {heading === undefined ? (
        <>
          <h1 className="one-chat-welcome-title">
            <T>What are we building?</T>
          </h1>
          {project ? <p className="one-chat-welcome-lead">{project.title}</p> : null}
        </>
      ) : (
        <div className="one-chat-welcome-heading">{heading}</div>
      )}
      <ul className="one-chat-starters" aria-label={gt("Ways to start")}>
        {starters.map((starter) => {
          const keycap =
            (starter.command ? shortcutLabelForCommand(keybindings, starter.command) : null) ??
            starter.keycap;
          return (
            <li key={starter.id}>
              <button type="button" className="one-chip" data-one-reflect="" onClick={starter.run}>
                <starter.icon aria-hidden="true" className="size-4" />
                {starter.label}
                {keycap ? <Kbd>{keycap}</Kbd> : null}
                <span aria-hidden="true" className="one-reflection" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The chat mode welcome: a greeting, ways to start, and the way into voice chat. */
export function ChatWelcome({ compact = false }: { readonly compact?: boolean }) {
  const gt = useGT();
  const composer = useComposerHandleContext();
  const voice = useVoiceBridge();
  const hour = new Date(useNowMinute()).getHours();
  const starters: ReadonlyArray<{ icon: LucideIcon; label: string; stem: string }> = [
    { icon: GraduationCapIcon, label: gt("Learn something"), stem: gt("Teach me about ") },
    { icon: LightbulbIcon, label: gt("Brainstorm"), stem: gt("Brainstorm ideas with me for ") },
    {
      icon: ScaleIcon,
      label: gt("Think it through"),
      stem: gt("Help me think through this decision: "),
    },
    { icon: CircleHelpIcon, label: gt("Quiz me"), stem: gt("Quiz me on ") },
  ];

  const startWith = (stem: string) => {
    const handle = composer?.current;
    const empty = handle?.readSnapshot().value.trim().length === 0;
    // The composer can refuse text, for example while dictation holds it. Say so instead of
    // letting the chip look broken.
    if (!handle || (empty && handle.insertTextAtEnd(stem) === false)) {
      toastManager.add({
        id: "chat-starter-composer-busy",
        type: "info",
        title: gt("The composer is busy"),
        description: gt("Finish what it is doing, then pick a way to start."),
      });
      return;
    }
    handle.focusAtEnd();
  };

  return (
    <div className="one-chat-welcome" data-compact={compact || undefined}>
      <WelcomeOrb />
      <h1 className="one-chat-welcome-title">{greetingFor(hour, gt)}</h1>
      <p className="one-chat-welcome-lead">
        <T>Ask a question, or pick a way to start.</T>
      </p>
      <ul className="one-chat-starters" aria-label={gt("Ways to start")}>
        {starters.map((starter) => (
          <li key={starter.label}>
            <button
              type="button"
              className="one-chip"
              data-one-reflect=""
              onClick={() => startWith(starter.stem)}
            >
              <starter.icon aria-hidden="true" className="size-4" />
              {starter.label}
              <span aria-hidden="true" className="one-reflection" />
            </button>
          </li>
        ))}
        {voice?.available ? (
          <li>
            <button
              type="button"
              className="one-chip"
              data-one-reflect=""
              data-tone="brand"
              onClick={() => startVoiceChat(voice)}
            >
              <AudioLinesIcon aria-hidden="true" className="size-4" />
              <T>Talk instead</T>
              <span aria-hidden="true" className="one-reflection" />
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
