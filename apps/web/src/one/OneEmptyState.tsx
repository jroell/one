import { T, useGT } from "gt-react";
import { createContext, use } from "react";
import {
  AudioLinesIcon,
  CircleHelpIcon,
  GraduationCapIcon,
  LightbulbIcon,
  ScaleIcon,
  type LucideIcon,
} from "lucide-react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useNowMinute } from "~/hooks/useNowMinute";
import { OneMark } from "./OneMark";
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

/** Shown in a thread with no messages yet. */
export function OneEmptyState() {
  const mode = useWorkspaceMode();
  const mainConversation = use(MainConversationContext);
  if (mode === "chat" && mainConversation) return <ChatWelcome />;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <OneMark className="size-12 opacity-90" />
      <p className="text-sm text-muted-foreground">
        <T>Send a message to start the conversation.</T>
      </p>
    </div>
  );
}

/** The chat mode welcome: a greeting, ways to start, and the way into voice chat. */
export function ChatWelcome({ compact = false }: { readonly compact?: boolean }) {
  const gt = useGT();
  const composer = useComposerHandleContext();
  const voice = useVoiceBridge();
  // Voice chat draws its own ring over this screen; two live rings would cost twice.
  const voiceOpen = useVoiceSession().stage !== "off";
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
      {voiceOpen ? (
        <div className="one-chat-welcome-orb aspect-square" />
      ) : (
        <OneOrb className="one-chat-welcome-orb" />
      )}
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
