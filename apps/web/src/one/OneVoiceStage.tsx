import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useThreadVisibleTurnItems } from "~/state/entities";
import { OneOrb, type OneOrbState } from "./OneOrb";
import { useVoiceBridge, voiceLevel, type VoiceBridge } from "./voiceBridge";
import {
  createSilenceDetector,
  dispatchVoiceSession,
  getVoiceSession,
  holdMicrophone,
  speakableText,
  useVoiceSession,
  type VoiceStage,
} from "./voiceSession";
import { useWorkspaceMode } from "./workspaceMode";

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

/** How long a finished turn may take to show its reply before voice chat listens again. */
const REPLY_GRACE_MS = 4_000;
/** How long a send may sit without starting a turn before voice chat listens again. */
const SEND_STALL_MS = 6_000;
/** How long the microphone may take to begin before voice chat closes (setup needed or refused). */
const START_REFUSED_MS = 2_500;

let mountedStages = 0;

/** Makes quiet speech visible on the ring without letting loud speech clip. */
function displayLevel(level: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, level)) * 1.35);
}

/**
 * Voice chat: speak, the question is sent when you pause, and the reply is
 * read back. It drives the main composer's own dictation, so the transcript
 * and the reply land in the thread like any typed message.
 */
export function OneVoiceStage(props: {
  /** The saved thread, or null for a draft that has no turn items yet. */
  readonly threadRef: ScopedThreadRef | null;
  readonly isWorking: boolean;
  /** The turn is waiting for an approval or an answer that only the page behind can give. */
  readonly needsUser: boolean;
  /** The conversation is covered or inert (a maximized panel), so the dialog could not be seen. */
  readonly conversationHidden?: boolean;
  /** Messages of a draft thread; a saved thread's replies are read from its turn items. */
  readonly draftMessages: ReadonlyArray<VoiceStageMessage>;
}) {
  const session = useVoiceSession();
  // A conversation cannot outlive the screen that shows it. The check runs a tick
  // later so a development re-mount of this component does not end it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the shared voice session when the last voice stage leaves the page
  useEffect(() => {
    mountedStages += 1;
    return () => {
      mountedStages -= 1;
      queueMicrotask(() => {
        if (mountedStages === 0) dispatchVoiceSession({ type: "stop" });
      });
    };
  }, []);
  // Reply text streams token by token, so only an open voice chat subscribes to it.
  if (session.stage === "off") return null;
  return <ActiveVoiceStage {...props} />;
}

function ActiveVoiceStage({
  threadRef,
  isWorking,
  needsUser,
  conversationHidden = false,
  draftMessages,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly isWorking: boolean;
  readonly needsUser: boolean;
  readonly conversationHidden?: boolean;
  readonly draftMessages: ReadonlyArray<VoiceStageMessage>;
}) {
  const gt = useGT();
  const session = useVoiceSession();
  const liveBridge = useVoiceBridge();
  const mode = useWorkspaceMode();
  const stage = session.stage;
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

  // Only the composer of the thread this conversation started in may be driven.
  // A draft that has sent its first question becomes a saved thread under a new key:
  // that one change of key is the same conversation, not another thread.
  const promoted =
    liveBridge !== null &&
    session.threadKey !== null &&
    liveBridge.threadKey !== session.threadKey &&
    session.startedAsDraft &&
    stage !== "listening" &&
    liveBridge.continuesDraft(session.threadKey);
  const promotedKey = promoted ? liveBridge.threadKey : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the shared voice session to the saved thread its draft became
  useEffect(() => {
    if (promotedKey !== null) dispatchVoiceSession({ type: "promoted", threadKey: promotedKey });
  }, [promotedKey]);
  const bridge: VoiceBridge | null =
    liveBridge !== null && (liveBridge.threadKey === session.threadKey || promoted)
      ? liveBridge
      : null;
  const levelRef = useRef(0);
  const speechPulseRef = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const orbButtonRef = useRef<HTMLButtonElement | null>(null);
  const startRequestedRef = useRef(false);
  /** True from this session's own start request until that recording has settled back to idle. */
  const ownRecordingRef = useRef(false);
  /** Whether that recording has been seen running, so a return to idle means it finished. */
  const ownRecordingSeenRef = useRef(false);
  const draftToastShownRef = useRef(false);

  const latestAssistant = messages.findLast((message) => message.role === "assistant") ?? null;
  const reply =
    latestAssistant !== null && latestAssistant.id !== session.baselineMessageId
      ? latestAssistant
      : null;
  const replyReady = reply !== null && !reply.streaming;
  const replyLength = reply?.text.length ?? 0;
  const latest = useRef({ bridge, reply, latestAssistantId: latestAssistant?.id ?? null });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed bridge and reply to the frame loop, timers and speech effect below
  useEffect(() => {
    latest.current = { bridge, reply, latestAssistantId: latestAssistant?.id ?? null };
  });

  const submit = () => {
    const current = latest.current;
    // The pause detector and the ring button can both fire in one frame; only the first sends.
    if (!current.bridge || getVoiceSession().stage !== "listening") return;
    dispatchVoiceSession({ type: "sent", latestAssistantMessageId: current.latestAssistantId });
    current.bridge.submit();
  };
  const submitRef = useRef(submit);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the frame loop calling the committed submit
  useEffect(() => {
    submitRef.current = submit;
  });

  // The conversation ends when its thread, its composer or chat mode goes away,
  // and steps aside when the turn needs an approval or an answer from the page behind.
  const orphaned = bridge === null || mode !== "chat" || conversationHidden;
  const blockedOnUser = needsUser;
  // Something typed or attached since the last turn would ride along with the next spoken question.
  const draftInTheWay = stage === "listening" && bridge?.phase === "idle" && !bridge.draftEmpty;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the shared voice session when the thread, composer or mode it belongs to is gone
  useEffect(() => {
    if (!(orphaned || blockedOnUser || draftInTheWay)) return;
    if (draftInTheWay && !draftToastShownRef.current) {
      // Development runs effects twice; the person should still see one notice.
      draftToastShownRef.current = true;
      toastManager.add({
        type: "info",
        title: gt("Voice chat ended"),
        description: gt("The composer still holds a message. Send or clear it, then start again."),
      });
    }
    dispatchVoiceSession({ type: "stop" });
  }, [orphaned, blockedOnUser, draftInTheWay, gt]);

  // Listening: start the composer's recording once, then send when the speaker pauses.
  const recordingPhase = bridge?.phase ?? "idle";
  const bridgeReady = bridge?.available === true;
  // A turn that was already running is not ours: wait for it instead of talking over it.
  const waitingForThread = stage === "listening" && isWorking && recordingPhase === "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the microphone when the listening stage begins; the recorder is outside React
  useEffect(() => {
    if (stage !== "listening") {
      startRequestedRef.current = false;
      return;
    }
    // One request per listening turn: a refused start (setup needed, mic blocked) must not retry in a loop.
    if (!bridgeReady || waitingForThread || recordingPhase !== "idle") return;
    if (startRequestedRef.current) return;
    // The stop effect above may have just ended the conversation in this same commit.
    if (orphaned || blockedOnUser || draftInTheWay || getVoiceSession().stage !== "listening")
      return;
    const current = latest.current.bridge;
    if (!current) return;
    startRequestedRef.current = true;
    ownRecordingRef.current = true;
    ownRecordingSeenRef.current = false;
    // Held from the request itself, so ending voice chat also stops a start that is still pending.
    holdMicrophone(current.cancel);
    current.start();
  }, [
    stage,
    bridgeReady,
    waitingForThread,
    recordingPhase,
    orphaned,
    blockedOnUser,
    draftInTheWay,
  ]);

  // This session owns exactly one recorder operation at a time: the one its own start
  // request began. Ownership ends when that operation settles (back to idle after it
  // was seen running) or fails. A dictation someone starts afterwards with the ordinary
  // shortcut is theirs: voice chat neither sends it nor cancels it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the recorder operation this voice session started and releases its hold when that operation ends
  useEffect(() => {
    if (!ownRecordingRef.current) return;
    if (recordingPhase === "idle" && !ownRecordingSeenRef.current) return;
    if (recordingPhase !== "idle" && recordingPhase !== "error") {
      ownRecordingSeenRef.current = true;
      return;
    }
    ownRecordingRef.current = false;
    ownRecordingSeenRef.current = false;
    holdMicrophone(null);
  }, [recordingPhase]);

  // The microphone never started (voice input needs setup, or the request was refused):
  // close voice chat and leave any setup screen it opened alone.
  const startRefused =
    stage === "listening" && bridgeReady && !waitingForThread && recordingPhase === "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a microphone request that never began; cleared as soon as recording starts
  useEffect(() => {
    if (!startRefused) return;
    const timer = window.setTimeout(() => {
      // Nothing was ever recording, so there is nothing to cancel. Dropping the hold first
      // leaves a slow status check free to open voice setup after voice chat has closed.
      ownRecordingRef.current = false;
      holdMicrophone(null);
      dispatchVoiceSession({ type: "stop" });
    }, START_REFUSED_MS);
    return () => window.clearTimeout(timer);
  }, [startRefused]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples the live microphone level each frame, which React state would re-render on
  useEffect(() => {
    const detector = createSilenceDetector();
    let frame = requestAnimationFrame(function tick(now) {
      if (stage === "listening" && recordingPhase === "recording" && ownRecordingRef.current) {
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
  }, [stage, recordingPhase]);

  // Sending: the question is on its way once the transcript is in and the thread reports work.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- advances the spoken turn from the thread's work state, which lives outside this component
  useEffect(() => {
    if (stage !== "sending") return;
    if (recordingPhase === "error") dispatchVoiceSession({ type: "failed" });
    else if (isWorking && recordingPhase === "idle") dispatchVoiceSession({ type: "working" });
  }, [stage, isWorking, recordingPhase]);

  // A send that never starts a turn (nothing to send, no provider) must not leave the ring spinning.
  const sendStalled = stage === "sending" && !isWorking && recordingPhase === "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a send that produced no turn; the timer is cleared when the turn starts
  useEffect(() => {
    if (!sendStalled) return;
    const timer = window.setTimeout(() => dispatchVoiceSession({ type: "failed" }), SEND_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [sendStalled]);

  // Thinking: read the reply once the turn is over and the reply has finished streaming.
  // A turn that ends without one gets a short grace period, then voice chat listens again.
  const turnOver = stage === "thinking" && !isWorking;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- waits for the finished reply of the turn; the timer covers a turn that ends with nothing to read
  useEffect(() => {
    if (!turnOver) return;
    // The length is read here so a reply whose text arrives after its item re-runs this check.
    if (
      replyReady &&
      replyLength > 0 &&
      speakableText(latest.current.reply?.text ?? "").length > 0
    ) {
      dispatchVoiceSession({ type: "replied", hasNewReply: true });
      return;
    }
    const timer = window.setTimeout(
      () => dispatchVoiceSession({ type: "replied", hasNewReply: false }),
      REPLY_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [turnOver, replyReady, replyLength]);

  // Speaking: read the reply aloud once, from the text it had when reading began.
  const speakingReplyId = stage === "speaking" ? (reply?.id ?? null) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the browser speech synthesizer, an external system, for the speaking stage
  useEffect(() => {
    if (speakingReplyId === null) return;
    const synthesis = typeof window === "undefined" ? undefined : window.speechSynthesis;
    const text = speakableText(latest.current.reply?.text ?? "");
    if (!synthesis || typeof SpeechSynthesisUtterance === "undefined" || text.length === 0) {
      dispatchVoiceSession({ type: "spoken" });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
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
  }, [speakingReplyId]);

  // Opening takes focus and keeps it; closing releases the microphone and gives focus back.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns keyboard focus and the Escape key while the voice dialog is open, and releases the recorder when it closes
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    orbButtonRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A menu, select or dialog opened over voice chat closes first.
      const stageElement = stageRef.current;
      const layers = document.querySelectorAll(
        "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]",
      );
      if ([...layers].some((layer) => layer !== stageElement)) return;
      event.preventDefault();
      event.stopPropagation();
      dispatchVoiceSession({ type: "stop" });
    };
    // Dictation hands focus back to the composer under the dialog when it finishes; take it back.
    // Focus that moves into another dialog (voice setup, a menu) is left alone.
    const onFocusIn = (event: FocusEvent) => {
      const stageElement = stageRef.current;
      if (!stageElement || !(event.target instanceof Element)) return;
      if (stageElement.contains(event.target)) return;
      const otherLayer = event.target.closest(
        "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]",
      );
      if (otherLayer !== null) return;
      orbButtonRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      // A development re-run of this effect must not move focus while the dialog stays open.
      if (getVoiceSession().stage !== "off") return;
      if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);

  if (bridge === null) return null;

  const micError = stage === "listening" && bridge.phase === "error" ? bridge.error : null;
  const preparing =
    stage === "listening" && (bridge.phase === "idle" || bridge.phase === "preparing");
  const status =
    micError !== null
      ? gt("Voice input stopped")
      : waitingForThread
        ? gt("Waiting for the current reply")
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
    if (stage === "listening" && bridge.phase === "recording" && ownRecordingRef.current) submit();
    else if (stage === "speaking") dispatchVoiceSession({ type: "spoken" });
  };

  // Tab stays inside the dialog: the page behind it is covered.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])"),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-modal="true"
      aria-label={gt("Voice chat")}
      data-one-voice-stage={stage}
      className="one-voice-stage"
      onKeyDown={onKeyDown}
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
          <OneOrb
            state={stage === "off" ? "idle" : ORB_STATE[stage]}
            levelRef={levelRef}
            className="w-full"
          />
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
