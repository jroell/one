import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useThreadVisibleTurnItems } from "~/state/entities";
import { OneOrb, type OneOrbState } from "./OneOrb";
import {
  getCommittedVoiceThreadKey,
  useVoiceBridge,
  voiceLevel,
  type VoiceBridge,
} from "./voiceBridge";
import { applyVoiceChatStyle, getVoiceChatStyle, replyLanguage } from "./voiceChatPreferences";
import {
  beginMicrophone,
  createSilenceDetector,
  dispatchVoiceSession,
  getVoiceSession,
  replyAnchor,
  selectReply,
  settleMicrophone,
  speakableText,
  speechDeadlineMs,
  useVoiceSession,
  type VoiceMessage,
  type VoiceStage,
} from "./voiceSession";
import { useWorkspaceMode } from "./workspaceMode";

export type VoiceStageMessage = VoiceMessage;

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
/** How long the microphone may take to begin before voice chat closes (setup needed, refused or unavailable). */
const START_REFUSED_MS = 2_500;
/** How long a spoken question may sit in recording, transcription or cleanup before it is given up on. */
const SEND_OPERATION_MS = 60_000;
/** How long speech may take to begin before an idle synthesizer is taken to have dropped it. */
const SPEECH_START_MS = 4_000;
/** How long the first deep-voice reply waits for the device to list its voices. */
const VOICES_WAIT_MS = 1_500;

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
      : turnItems.flatMap((row): VoiceStageMessage[] => {
          const item = row.item;
          if (item.type === "user_message") {
            return [{ id: item.id, role: "user", text: item.text, streaming: false }];
          }
          if (item.type === "assistant_message") {
            return [
              {
                id: item.id,
                role: "assistant",
                text: item.text,
                streaming: item.streaming,
                commentary: item.phase === "commentary" || item.delivery === "async",
              },
            ];
          }
          return [];
        });

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
  /** The recorder was already in its error phase when this operation began, so that error is not its own. */
  const ownStartedInErrorRef = useRef(false);
  const draftToastShownRef = useRef(false);
  /** The microphone has been asked to start in this conversation, so an error on it is this conversation's. */
  const [attempted, setAttempted] = useState(false);

  const answer =
    (stage === "sending" || stage === "thinking") && session.sentAfter !== null
      ? selectReply(messages, session.sentAfter)
      : null;
  const answerText = answer === null ? "" : speakableText(answer.text);
  const answerReady = answer !== null && !answer.streaming && answerText.length > 0;
  const answerId = answer?.id ?? null;
  const latest = useRef({ bridge, messages });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed bridge and messages to the frame loop, timers and speech effect below
  useEffect(() => {
    latest.current = { bridge, messages };
  });

  const submit = () => {
    const current = latest.current;
    // The pause detector and the ring button can both fire in one frame; only the first sends.
    if (!current.bridge || getVoiceSession().stage !== "listening") return;
    // A frame queued before the composer moved to another thread must not send that thread's draft.
    const committedKey = getCommittedVoiceThreadKey();
    if (committedKey !== null && committedKey !== getVoiceSession().threadKey) {
      dispatchVoiceSession({ type: "stop" });
      return;
    }
    dispatchVoiceSession({ type: "sent", after: replyAnchor(current.messages) });
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
  // A layout effect, so the conversation is over in the commit that removed its thread or mode,
  // before any frame or timer queued for it can run.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the shared voice session when the thread, composer or mode it belongs to is gone
  useLayoutEffect(() => {
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

  const reclaimFocus = useStableCallback(() => {
    const stageElement = stageRef.current;
    const active = document.activeElement;
    if (!stageElement || (active !== null && stageElement.contains(active))) return;
    if (
      active === null ||
      active === document.body ||
      active.closest('[data-chat-composer-form="true"]') !== null
    ) {
      orbButtonRef.current?.focus();
    }
  });

  // One function starts the microphone, for the first attempt and for a retry alike: it registers
  // how to cancel it before starting, so ending voice chat always reaches the recording it began.
  const beginRecording = useStableCallback((target: VoiceBridge) => {
    startRequestedRef.current = true;
    ownRecordingRef.current = true;
    ownRecordingSeenRef.current = false;
    ownStartedInErrorRef.current = target.phase === "error";
    setAttempted(true);
    beginMicrophone((signal) => target.start(signal), target.cancel);
  });

  // Listening: start the composer's recording once, then send when the speaker pauses.
  const recordingPhase = bridge?.phase ?? "idle";
  const bridgeReady = bridge?.available === true;
  // A turn that was already running is not ours: wait for it instead of talking over it.
  const waitingForThread = stage === "listening" && isWorking && recordingPhase === "idle";
  const sendFailed = session.error !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the microphone when the listening stage begins; the recorder is outside React
  useEffect(() => {
    if (stage !== "listening") {
      startRequestedRef.current = false;
      return;
    }
    // One request per listening turn: a refused start (setup needed, mic blocked) must not retry in a loop.
    // A failed send waits for the person to choose Try again.
    if (!bridgeReady || waitingForThread || recordingPhase !== "idle" || sendFailed) return;
    if (startRequestedRef.current) return;
    // The stop effect above may have just ended the conversation in this same commit.
    if (orphaned || blockedOnUser || draftInTheWay || getVoiceSession().stage !== "listening")
      return;
    const current = latest.current.bridge;
    if (!current) return;
    beginRecording(current);
  }, [
    stage,
    bridgeReady,
    waitingForThread,
    recordingPhase,
    sendFailed,
    orphaned,
    blockedOnUser,
    draftInTheWay,
    beginRecording,
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
    // A retry begun from an error sees that same error until its own recording starts.
    if (recordingPhase === "error" && ownStartedInErrorRef.current && !ownRecordingSeenRef.current)
      return;
    ownRecordingRef.current = false;
    ownRecordingSeenRef.current = false;
    settleMicrophone();
    // Dictation hands focus to the composer as it finishes.
    reclaimFocus();
  }, [recordingPhase, reclaimFocus]);

  // The microphone never started (voice input needs setup, was refused, or is no longer
  // available): close voice chat and leave any setup screen it opened alone.
  const micStalled =
    stage === "listening" && !waitingForThread && recordingPhase === "idle" && !sendFailed;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a microphone request that never began; cleared as soon as recording starts
  useEffect(() => {
    if (!micStalled) return;
    const timer = window.setTimeout(() => {
      // Nothing was ever recording, so there is nothing to cancel. Settling first tells a slow status
      // check not to open the microphone, yet leaves it free to open voice setup.
      ownRecordingRef.current = false;
      settleMicrophone();
      if (latest.current.bridge?.available !== true) {
        toastManager.add({
          type: "info",
          title: gt("Voice chat ended"),
          description: gt(
            "Voice input is no longer available. Check Voice settings, then start again.",
          ),
        });
      }
      dispatchVoiceSession({ type: "stop" });
    }, START_REFUSED_MS);
    return () => window.clearTimeout(timer);
  }, [micStalled, gt]);

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
    if (recordingPhase === "error") {
      const message = latest.current.bridge?.error;
      dispatchVoiceSession(message ? { type: "failed", message } : { type: "failed" });
    } else if (isWorking && recordingPhase === "idle") dispatchVoiceSession({ type: "working" });
  }, [stage, isWorking, recordingPhase]);

  // A send that never starts a turn (nothing to send, no provider) must not leave the ring spinning.
  const sendStalled = stage === "sending" && !isWorking && recordingPhase === "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a send that produced no turn; the timer is cleared when the turn starts
  useEffect(() => {
    if (!sendStalled) return;
    const timer = window.setTimeout(() => dispatchVoiceSession({ type: "failed" }), SEND_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [sendStalled]);

  // A question stuck in recording, transcription or cleanup has its own deadline, ending in an
  // error with Try again. The send timeout above only runs while the recorder is idle.
  const sendingPhase =
    stage === "sending" && recordingPhase !== "idle" && recordingPhase !== "error"
      ? recordingPhase
      : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gives up on a spoken question whose recorder operation never finishes
  useEffect(() => {
    if (sendingPhase === null) return;
    const timer = window.setTimeout(() => {
      if (ownRecordingRef.current) latest.current.bridge?.cancel();
      dispatchVoiceSession({ type: "failed", message: gt("Voice input took too long") });
    }, SEND_OPERATION_MS);
    return () => window.clearTimeout(timer);
  }, [sendingPhase, gt]);

  // Sending or thinking: read the answer once the turn is over and it has finished streaming.
  // The finished answer can be seen without any frame that showed the thread working.
  // A turn that ends without one gets a short grace period, then voice chat listens again.
  const answerSettled =
    !isWorking && (stage === "thinking" || (stage === "sending" && recordingPhase === "idle"));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- waits for the finished answer to the question that was sent; the timer covers a turn that ends with nothing to read
  useEffect(() => {
    if (!answerSettled) return;
    if (answerReady && answerId !== null) {
      dispatchVoiceSession({ type: "replied", reply: { id: answerId, text: answerText } });
      return;
    }
    // A send that is still waiting to start a turn has its own timeout above.
    if (stage !== "thinking") return;
    const timer = window.setTimeout(
      () => dispatchVoiceSession({ type: "replied", reply: null }),
      REPLY_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [answerSettled, stage, answerReady, answerId, answerText]);

  // Speaking: read the reply aloud once, from the text it had when reading began.
  const speakingReplyId = stage === "speaking" ? (session.reply?.id ?? null) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the browser speech synthesizer, an external system, for the speaking stage
  useEffect(() => {
    if (speakingReplyId === null) return;
    const current = getVoiceSession();
    const spoken = current.reply;
    if (spoken === null || spoken.id !== speakingReplyId) return;
    // A reply belongs to the thread it was asked in; never read it over another thread.
    const committedKey = getCommittedVoiceThreadKey();
    if (committedKey !== null && committedKey !== current.threadKey) {
      dispatchVoiceSession({ type: "stop" });
      return;
    }
    const synthesis = typeof window === "undefined" ? undefined : window.speechSynthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === "undefined" || spoken.text.length === 0) {
      dispatchVoiceSession({ type: "spoken", replyId: spoken.id });
      return;
    }
    let finished = false;
    let started = false;
    let startWatch: number | undefined;
    let deadline: number | undefined;
    let voicesWait: number | undefined;
    let onVoices: (() => void) | undefined;
    const finish = () => {
      // A late event of this reading must not end another turn's.
      if (finished) return;
      finished = true;
      dispatchVoiceSession({ type: "spoken", replyId: spoken.id });
    };
    const speak = () => {
      if (finished) return;
      const utterance = new SpeechSynthesisUtterance(spoken.text);
      utterance.lang = replyLanguage(
        spoken.text,
        document.documentElement.lang || navigator.language,
      );
      applyVoiceChatStyle(utterance, synthesis.getVoices(), getVoiceChatStyle());
      utterance.onstart = () => {
        started = true;
      };
      utterance.onboundary = () => {
        speechPulseRef.current = 0.62;
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      synthesis.cancel();
      synthesis.speak(utterance);
      // Some engines drop an utterance without any event. Idle and never started means it is not coming.
      startWatch = window.setTimeout(() => {
        if (!started && !synthesis.speaking && !synthesis.pending) finish();
      }, SPEECH_START_MS);
      deadline = window.setTimeout(finish, speechDeadlineMs(spoken.text));
    };
    // The deep voice is chosen from the device's voice list, which is empty until the device reports it.
    if (getVoiceChatStyle() === "conqueror" && synthesis.getVoices().length === 0) {
      onVoices = () => {
        synthesis.removeEventListener("voiceschanged", onVoices as () => void);
        window.clearTimeout(voicesWait);
        speak();
      };
      synthesis.addEventListener("voiceschanged", onVoices);
      voicesWait = window.setTimeout(onVoices, VOICES_WAIT_MS);
    } else {
      speak();
    }
    return () => {
      finished = true;
      window.clearTimeout(startWatch);
      window.clearTimeout(deadline);
      window.clearTimeout(voicesWait);
      if (onVoices) synthesis.removeEventListener("voiceschanged", onVoices);
      synthesis.cancel();
    };
  }, [speakingReplyId]);

  // The device lists its voices lazily; asking when voice chat opens gives it time to answer.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- primes the browser's voice list, an external system
  useEffect(() => {
    window.speechSynthesis?.getVoices();
  }, []);

  const stageRendered = bridge !== null;
  // Opening takes focus; closing releases the microphone and gives focus back. While open, what
  // the layer covers is inert, so keyboard and screen readers meet only what can be seen.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns keyboard focus, the covered content and the Escape key while the voice dialog is open
  useEffect(() => {
    if (!stageRendered) return;
    const stageElement = stageRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    orbButtonRef.current?.focus();
    const covered = [...(stageElement?.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== stageElement && !element.inert,
    );
    for (const element of covered) element.inert = true;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A menu, select or dialog opened over voice chat closes first.
      const layers = document.querySelectorAll(
        "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]",
      );
      if ([...layers].some((layer) => layer !== stageElement)) return;
      event.preventDefault();
      event.stopPropagation();
      dispatchVoiceSession({ type: "stop" });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      for (const element of covered) element.inert = false;
      // A development re-run of this effect must not move focus while the dialog stays open.
      if (getVoiceSession().stage !== "off") return;
      const usable =
        opener !== null &&
        opener !== document.body &&
        opener.isConnected &&
        opener.closest("[inert]") === null;
      // The launcher can be gone (another mode, another thread): the composer is where the person was writing.
      (usable
        ? opener
        : document.querySelector<HTMLElement>(
            '[data-chat-composer-form="true"] [data-testid="composer-editor"]',
          )
      )?.focus();
    };
  }, [stageRendered]);

  // Dictation hands focus to the composer when it finishes, and each stage changes what the
  // layer shows. Take focus back when it was dropped into the composer or nowhere; leave it
  // wherever else the person chose to put it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- returns keyboard focus to the voice dialog after a stage change
  useEffect(() => {
    if (stage !== "off") reclaimFocus();
  }, [stage, reclaimFocus]);

  if (bridge === null) return null;

  const recorderFailed = stage === "listening" && attempted && bridge.phase === "error";
  const micFailed = recorderFailed || (stage === "listening" && sendFailed);
  const micError = micFailed ? (recorderFailed ? bridge.error : session.error) : null;
  const unavailable =
    stage === "listening" &&
    !micFailed &&
    !waitingForThread &&
    !bridge.available &&
    bridge.phase === "idle";
  const preparing =
    stage === "listening" && (bridge.phase === "idle" || bridge.phase === "preparing");
  const status = micFailed
    ? gt("Voice input stopped")
    : waitingForThread
      ? gt("Waiting for the current reply")
      : unavailable
        ? gt("Voice input is not available")
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
      : stage === "speaking"
        ? (session.reply?.text ?? "")
        : answerText.length > 0
          ? answerText
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
    else if (stage === "speaking") {
      dispatchVoiceSession(
        session.reply ? { type: "spoken", replyId: session.reply.id } : { type: "spoken" },
      );
    }
  };
  const retry = () => {
    dispatchVoiceSession({ type: "retried" });
    beginRecording(bridge);
  };

  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-label={gt("Voice chat")}
      data-one-voice-stage={stage}
      className="one-voice-stage"
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
        <p
          className="one-voice-caption"
          data-kind={stage === "listening" ? "heard" : "reply"}
          role="region"
          aria-label={gt("Voice chat transcript")}
          tabIndex={caption.length > 0 ? 0 : undefined}
        >
          {caption}
        </p>
      </div>
      <div className="one-voice-stage-actions">
        {micFailed ? (
          <Button variant="outline" size="sm-pill" onClick={retry}>
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
