import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { useThreadVisibleTurnItems } from "~/state/entities";
import { OneOrb, type OneOrbState } from "./OneOrb";
import { useVoiceBridge, voiceLevel } from "./voiceBridge";
import {
  createSilenceDetector,
  dispatchVoiceSession,
  getVoiceSession,
  speakableText,
  useVoiceSession,
  type VoiceStage,
} from "./voiceSession";

export type VoiceStageMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming: boolean;
}>;

const ORB_STATE: Record<Exclude<VoiceStage, "off">, OneOrbState> = {
  listening: "listening",
  sending: "thinking",
  thinking: "thinking",
  speaking: "speaking",
};

/** Makes quiet speech visible on the ring without letting loud speech clip. */
function displayLevel(level: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, level)) * 1.35);
}

/**
 * Voice chat: speak, the question is sent when you pause, and the reply is
 * read back. It drives the composer's own dictation, so the transcript and
 * the reply land in the thread like any typed message.
 */
export function OneVoiceStage(props: {
  /** The saved thread, or null for a draft that has no turn items yet. */
  readonly threadRef: ScopedThreadRef | null;
  readonly isWorking: boolean;
  /** Messages of a draft thread; a saved thread's replies are read from its turn items. */
  readonly draftMessages: ReadonlyArray<VoiceStageMessage>;
}) {
  const session = useVoiceSession();
  // Reply text streams token by token, so only an open voice chat subscribes to it.
  if (session.stage === "off") return null;
  return <ActiveVoiceStage {...props} />;
}

function ActiveVoiceStage({
  threadRef,
  isWorking,
  draftMessages,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly isWorking: boolean;
  readonly draftMessages: ReadonlyArray<VoiceStageMessage>;
}) {
  const turnItems = useThreadVisibleTurnItems(threadRef);
  const messages: ReadonlyArray<VoiceStageMessage> =
    threadRef === null
      ? draftMessages
      : turnItems.flatMap((row) =>
          row.item.type === "assistant_message"
            ? [
                {
                  id: row.item.id,
                  role: "assistant" as const,
                  text: row.item.text,
                  streaming: row.item.streaming,
                },
              ]
            : [],
        );
  const gt = useGT();
  const session = useVoiceSession();
  const bridge = useVoiceBridge();
  const stage = session.stage;
  const active = stage !== "off";
  const levelRef = useRef(0);
  const speechPulseRef = useRef(0);
  const orbButtonRef = useRef<HTMLButtonElement | null>(null);
  const startRequestedRef = useRef(false);

  const latestAssistant = messages.findLast((message) => message.role === "assistant") ?? null;
  const reply =
    latestAssistant !== null && latestAssistant.id !== session.baselineMessageId
      ? latestAssistant
      : null;
  const latest = useRef({ bridge, latestAssistantId: latestAssistant?.id ?? null });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed bridge and message id to the frame loop and timers below
  useEffect(() => {
    latest.current = { bridge, latestAssistantId: latestAssistant?.id ?? null };
  });

  const submit = () => {
    const current = latest.current;
    if (!current.bridge) return;
    dispatchVoiceSession({ type: "sent", latestAssistantMessageId: current.latestAssistantId });
    current.bridge.submit();
  };
  const submitRef = useRef(submit);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the frame loop calling the committed submit
  useEffect(() => {
    submitRef.current = submit;
  });

  // Listening: start the composer's recording once, then send when the speaker pauses.
  const recordingPhase = bridge?.phase ?? "idle";
  const bridgeReady = bridge?.available === true;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the microphone when the listening stage begins; the recorder is outside React
  useEffect(() => {
    if (stage !== "listening") {
      startRequestedRef.current = false;
      return;
    }
    // One request per listening turn: a refused start (setup needed, mic blocked) must not retry in a loop.
    if (!bridgeReady || recordingPhase !== "idle" || startRequestedRef.current) return;
    startRequestedRef.current = true;
    latest.current.bridge?.start();
  }, [stage, bridgeReady, recordingPhase]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples the live microphone level each frame, which React state would re-render on
  useEffect(() => {
    if (!active) return;
    const detector = createSilenceDetector();
    let frame = requestAnimationFrame(function tick(now) {
      if (stage === "listening" && recordingPhase === "recording") {
        levelRef.current = displayLevel(voiceLevel.current);
        if (detector.sample(voiceLevel.current, now)) submitRef.current();
      } else if (stage === "speaking") {
        speechPulseRef.current *= 0.9;
        const murmur = 0.16 + 0.1 * Math.sin(now / 90) * Math.sin(now / 370);
        levelRef.current = Math.max(murmur, speechPulseRef.current);
      } else {
        levelRef.current = 0;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, stage, recordingPhase]);

  // Sending: the turn has started once the thread reports work; a failed transcript returns to listening.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- advances the spoken turn from the thread's work state, which lives outside this component
  useEffect(() => {
    if (stage === "sending") {
      if (isWorking) dispatchVoiceSession({ type: "working" });
      else if (recordingPhase === "error") dispatchVoiceSession({ type: "failed" });
    } else if (stage === "thinking" && !isWorking) {
      dispatchVoiceSession({
        type: "replied",
        hasNewReply: reply !== null && speakableText(reply.text).length > 0,
      });
    }
  }, [stage, isWorking, recordingPhase, reply]);

  // A send that never starts a turn (nothing to send, no provider) must not leave the ring spinning.
  const sendStalled = stage === "sending" && !isWorking && recordingPhase === "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a send that produced no turn; the timer is cleared when the turn starts
  useEffect(() => {
    if (!sendStalled) return;
    const timer = window.setTimeout(() => dispatchVoiceSession({ type: "failed" }), 6_000);
    return () => window.clearTimeout(timer);
  }, [sendStalled]);

  // Speaking: read the reply aloud, then listen again.
  const replyText = stage === "speaking" && reply ? reply.text : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the browser speech synthesizer, an external system, for the speaking stage
  useEffect(() => {
    if (replyText === null) return;
    const synthesis = typeof window === "undefined" ? undefined : window.speechSynthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") {
      dispatchVoiceSession({ type: "spoken" });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(speakableText(replyText));
    utterance.lang = document.documentElement.lang || navigator.language;
    utterance.rate = 1.04;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      dispatchVoiceSession({ type: "spoken" });
    };
    utterance.onboundary = () => {
      speechPulseRef.current = 0.62;
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    synthesis.cancel();
    synthesis.speak(utterance);
    return () => {
      finished = true;
      synthesis.cancel();
    };
  }, [replyText]);

  // Leaving voice chat always releases the microphone and the voice.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the microphone and focus when voice chat opens or closes
  useEffect(() => {
    if (!active) return;
    orbButtonRef.current?.focus();
    return () => {
      // Only a session that has really ended releases the microphone; a development
      // re-run of this effect must not cancel the recording it just started.
      if (getVoiceSession().stage === "off") latest.current.bridge?.cancel();
    };
  }, [active]);

  // The microphone never started (voice input needs setup, or the request was refused):
  // close voice chat so the setup screen is not left behind a waiting ring.
  const startRefused = stage === "listening" && bridgeReady && recordingPhase === "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a microphone request that never began; cleared as soon as recording starts
  useEffect(() => {
    if (!startRefused) return;
    const timer = window.setTimeout(() => dispatchVoiceSession({ type: "stop" }), 2_500);
    return () => window.clearTimeout(timer);
  }, [startRefused]);

  // The thread or composer went away: end the session instead of waiting on nothing.
  const bridgeMissing = bridge === null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the session when the composer that owns the microphone unmounts
  useEffect(() => {
    if (active && bridgeMissing) dispatchVoiceSession({ type: "stop" });
  }, [active, bridgeMissing]);

  if (!active || bridge === null) return null;

  const micError = stage === "listening" && bridge.phase === "error" ? bridge.error : null;
  const preparing =
    stage === "listening" && (bridge.phase === "idle" || bridge.phase === "preparing");
  const status =
    micError !== null
      ? gt("Voice input stopped")
      : stage === "listening"
        ? preparing
          ? gt("Getting the microphone ready")
          : gt("Listening")
        : stage === "speaking"
          ? gt("Speaking")
          : gt("Thinking");
  const caption =
    stage === "listening"
      ? (micError ?? bridge.heard)
      : reply
        ? speakableText(reply.text)
        : stage === "sending"
          ? bridge.heard
          : "";
  const orbLabel =
    stage === "listening"
      ? gt("Send what I said")
      : stage === "speaking"
        ? gt("Stop reading and listen")
        : gt("Waiting for the reply");

  const onOrbPress = () => {
    if (stage === "listening" && bridge.phase === "recording") submit();
    else if (stage === "speaking") dispatchVoiceSession({ type: "spoken" });
  };

  return (
    <div
      role="dialog"
      aria-label={gt("Voice chat")}
      data-one-voice-stage={stage}
      className="one-voice-stage"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        dispatchVoiceSession({ type: "stop" });
      }}
    >
      <div className="one-voice-stage-body">
        <button
          ref={orbButtonRef}
          type="button"
          className="one-voice-orb-button"
          aria-label={orbLabel}
          aria-disabled={stage === "sending" || stage === "thinking"}
          onClick={onOrbPress}
        >
          <OneOrb state={ORB_STATE[stage]} levelRef={levelRef} className="w-full" />
        </button>
        <p className="one-voice-status" role="status" aria-live="polite">
          {status}
        </p>
        <p className="one-voice-caption" data-kind={stage === "listening" ? "heard" : "reply"}>
          {caption}
        </p>
      </div>
      <div className="one-voice-stage-actions">
        {micError !== null ? (
          <Button variant="outline" size="sm-pill" onClick={() => bridge.start()}>
            {gt("Try the microphone again")}
          </Button>
        ) : null}
        <Button
          variant="glass"
          size="sm-pill"
          onClick={() => dispatchVoiceSession({ type: "stop" })}
        >
          <XIcon aria-hidden="true" />
          {gt("End voice chat")}
        </Button>
      </div>
    </div>
  );
}
