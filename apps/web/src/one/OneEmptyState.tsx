import { T, useGT } from "gt-react";
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
import { OneOrb } from "./OneOrb";
import { useVoiceBridge } from "./voiceBridge";
import { dispatchVoiceSession } from "./voiceSession";
import { useWorkspaceMode } from "./workspaceMode";

function greetingFor(hour: number, gt: ReturnType<typeof useGT>): string {
  if (hour < 5) return gt("Still up?");
  if (hour < 12) return gt("Good morning");
  if (hour < 18) return gt("Good afternoon");
  return gt("Good evening");
}

/** Shown in a thread with no messages yet. */
export function OneEmptyState() {
  const mode = useWorkspaceMode();
  if (mode === "chat") return <ChatWelcome />;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <OneOrb className="w-36" />
      <p className="text-sm text-muted-foreground">
        <T>Send a message to start the conversation.</T>
      </p>
    </div>
  );
}

function ChatWelcome() {
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
    if (!handle) return;
    if (handle.readSnapshot().value.trim().length === 0) handle.insertTextAtEnd(stem);
    handle.focusAtEnd();
  };

  return (
    <div className="one-chat-welcome">
      <OneOrb className="one-chat-welcome-orb" />
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
              onClick={() => dispatchVoiceSession({ type: "start" })}
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
