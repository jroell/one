import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { setToastsSuppressed, toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import {
  useQuietThreadProjection,
  useThreadStatus,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { threadTranscriptMayLag } from "~/threadSync";
import { OneVoiceGhost } from "./OneVoiceGhost";
import { openVoiceSettings } from "./startVoiceChat";
import { VoiceStageView, type VoiceLook } from "./OneVoiceStageView";
import {
  createCaptionProgress,
  estimatedSentenceTimesMs,
  sentenceStarts,
} from "./voiceCaptionProgress";
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
  hasPendingBlockingRequest,
  newVoiceSubmission,
  ownTurnState,
  ownsMicrophone,
  pendingFeedbackCardIds,
  replyAnchor,
  selectReply,
  settleMicrophone,
  speakableText,
  speechDeadlineMs,
  useVoiceSession,
  type VoiceMessage,
} from "./voiceSession";
import {
  EASE_ENTER_FALLBACK,
  HALO_REACH,
  SWELL_REACH,
  boxOf,
  clearVoiceExit,
  flightTo,
  flightTransform,
  motionMs,
  motionToken,
  prefersReducedMotion,
  expireVoiceExit,
  holdVoiceExit,
  preloadExitMark,
  getVoiceExit,
  smoothSwell,
  subscribeVoiceExit,
  takeVoiceLauncher,
  swellScale,
} from "./voiceStageMotion";
import { useWorkspaceMode } from "./workspaceMode";

export type VoiceStageMessage = VoiceMessage;

/** How long without a word timing event before the caption is warmed a sentence at a time instead. */
const NO_TIMING_WAIT_MS = 1_200;
/** How long the key hints stay after the last key or pointer move, and how many sessions show them at first. */
const HINTS_VISIBLE_MS = 3_000;
const HINT_SESSIONS_KEY = "one:voice-hint-sessions";
const HINT_SESSIONS_SHOWN = 3;
/** How long the "Interrupted" state shows before the stage listens again. */
const INTERRUPTED_MS = 900;

/** How long a finished turn may take to show its reply before voice chat listens again. */
const REPLY_GRACE_MS = 4_000;
/** How long a send may sit without starting a turn before voice chat listens again. */
const SEND_STALL_MS = 6_000;
/** How long the microphone may take to begin before voice chat closes (setup needed, refused or unavailable). */
const START_REFUSED_MS = 2_500;
/** How long a spoken question may sit in recording, transcription or cleanup before it is given up on. */
const SEND_OPERATION_MS = 60_000;
/** How long a request that went out may wait for the thread to show its run before it is given up on. */
const SEND_ACCEPT_MS = 60_000;
/** How long a turn that was being followed may be missing from the thread before it is given up on. */
const TURN_LOST_MS = 10_000;
/** How long a followed turn may go without a live thread connection before voice chat stops waiting on it. */
const RECONNECT_GRACE_MS = 20_000;
/** How long speech may take to begin before an idle synthesizer is taken to have dropped it. */
const SPEECH_START_MS = 4_000;
/** How long an utterance the engine holds back may wait for its start event before it is retried once, then given up on. */
const SPEECH_ENGINE_START_MS = 6_000;
/** How long the first deep-voice reply waits for the device to list its voices. */
const VOICES_WAIT_MS = 1_500;

let mountedStages = 0;
const NO_RUNS: ReadonlyArray<never> = [];

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
  // Leaving flies the ring back to where voice chat was opened from, for one exit beat.
  const exit = useSyncExternalStore(subscribeVoiceExit, getVoiceExit);
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
  if (session.stage === "off") {
    return exit === null ? null : <OneVoiceGhost plan={exit} onDone={clearVoiceExit} />;
  }
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
            return [
              {
                id: item.id,
                role: "user",
                messageId: item.messageId,
                text: item.text,
                streaming: false,
                runId: item.runId,
                steer:
                  item.inputIntent === "steer" || item.inputIntent === "promoted_queued_to_steer",
              },
            ];
          }
          if (item.type === "assistant_message") {
            return [
              {
                id: item.id,
                role: "assistant",
                text: item.text,
                streaming: item.streaming,
                commentary: item.phase === "commentary" || item.delivery === "async",
                runId: item.runId,
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
  const speechPulseRef = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const orbButtonRef = useRef<HTMLButtonElement | null>(null);
  const startRequestedRef = useRef(false);
  /** Whether the recording this session started has been seen running, so a return to idle means it finished. */
  const ownRecordingSeenRef = useRef(false);
  /** The recorder was already in its error phase when this operation began, so that error is not its own. */
  const ownStartedInErrorRef = useRef(false);
  const draftToastShownRef = useRef(false);
  /** The microphone has been asked to start in this conversation, so an error on it is this conversation's. */
  const [attempted, setAttempted] = useState(false);
  /** The person just stopped a reply, so the stage shows that for a moment before it listens. */
  const [interrupted, setInterrupted] = useState(false);
  const muted = session.muted;
  const orbWrapRef = useRef<HTMLDivElement | null>(null);
  const swellRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLParagraphElement | null>(null);
  /** The smoothed sound level the ring and halo follow; it carries across states so nothing jumps. */
  const swellValueRef = useRef(0);
  const originRef = useRef<Element | null | undefined>(undefined);

  // A saved thread's turn is followed through its own question and run. A draft has no other work.
  const runs = useQuietThreadProjection(threadRef)?.projection.runs ?? NO_RUNS;
  const ownTurn =
    threadRef === null
      ? isWorking
        ? "open"
        : "ended"
      : ownTurnState(messages, runs, session.messageId);
  const answer =
    (stage === "sending" || stage === "thinking") && session.sentAfter !== null
      ? selectReply(messages, session.sentAfter, {
          messageId: session.messageId,
          readIds: session.readIds,
          readRuns: session.readRuns,
        })
      : null;
  const answerText = answer === null ? "" : speakableText(answer.text);
  const answerReady = answer !== null && !answer.streaming && answerText.length > 0;
  const answerId = answer?.id ?? null;
  const answerRunId = answer?.runId ?? null;
  const tookTooLong = gt("Voice input took too long");
  const notSent = gt("The question was not sent");
  const sentToSideChat = gt("That went to a side chat, so there is no reply to read here");
  const notices = {
    notAccepted: gt("The question was not accepted in time"),
    held: gt("The question is held in the queue, so there is no reply to read yet"),
    lost: gt("The reply is no longer available"),
    disconnected: gt(
      "Lost the connection. Your question was sent; the answer will appear in the thread.",
    ),
  };
  const latest = useRef({ bridge, messages, tookTooLong, notSent, sentToSideChat, notices });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed bridge, messages and notices for the frame loop, timers and speech effect below
  useEffect(() => {
    latest.current = { bridge, messages, tookTooLong, notSent, sentToSideChat, notices };
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
    const submission = newVoiceSubmission();
    dispatchVoiceSession({
      type: "sent",
      after: replyAnchor(current.messages),
      submission,
      heard: current.bridge.heard,
    });
    current.bridge.submit({
      sent: (messageId) => dispatchVoiceSession({ type: "identified", submission, messageId }),
      rejected: (message) =>
        dispatchVoiceSession({
          type: "failed",
          submission,
          message: message ?? latest.current.notSent,
        }),
      notSent: (destination) =>
        dispatchVoiceSession({
          type: "failed",
          submission,
          message:
            destination === "side-chat" ? latest.current.sentToSideChat : latest.current.notSent,
        }),
    });
  };
  const submitRef = useRef(submit);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the frame loop calling the committed submit
  useEffect(() => {
    submitRef.current = submit;
  });

  // The conversation ends when its thread, its composer or chat mode goes away,
  // and steps aside when the turn needs an approval or an answer from the page behind.
  const orphaned = bridge === null || mode !== "chat" || conversationHidden;
  // A secret or link card waits for the person just as an approval does. A feedback card is optional:
  // one left from before voice chat started is ignored, one that arrives during it ends it.
  const [feedbackAtStart] = useState(() => new Set(pendingFeedbackCardIds(turnItems)));
  const feedbackArrived = pendingFeedbackCardIds(turnItems).some((id) => !feedbackAtStart.has(id));
  const blockedOnUser = needsUser || hasPendingBlockingRequest(turnItems) || feedbackArrived;
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
    ownRecordingSeenRef.current = false;
    ownStartedInErrorRef.current = target.phase === "error";
    setAttempted(true);
    void beginMicrophone((signal) => target.start(signal), target.cancel);
  });

  // Listening: start the composer's recording once, then send when the speaker pauses.
  const recordingPhase = bridge?.phase ?? "idle";
  const bridgeReady = bridge?.available === true;
  // A turn that was already running is not ours: wait for it instead of talking over it.
  const waitingForThread = stage === "listening" && isWorking && recordingPhase === "idle";
  const sendFailed = session.error !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the microphone when the listening stage begins; the recorder is outside React
  useEffect(() => {
    if (stage !== "listening" || muted) {
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
    muted,
    orphaned,
    blockedOnUser,
    draftInTheWay,
    beginRecording,
  ]);

  // Muting stops a recording this conversation started; unmuting starts the next one above.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the recorder, which lives outside React, when the person mutes
  useEffect(() => {
    if (muted && getVoiceSession().stage === "listening" && ownsMicrophone()) {
      latest.current.bridge?.cancel();
    }
  }, [muted]);

  // This session owns exactly one recorder operation at a time: the one its own start
  // request began. Ownership ends when that attempt reports it did not record (see
  // beginMicrophone), or when the operation settles (back to idle after it was seen
  // running) or fails. A dictation someone starts afterwards with the ordinary
  // shortcut is theirs: voice chat neither sends it nor cancels it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the recorder operation this voice session started and releases its hold when that operation ends
  useEffect(() => {
    if (!ownsMicrophone()) return;
    if (recordingPhase === "idle" && !ownRecordingSeenRef.current) return;
    if (recordingPhase !== "idle" && recordingPhase !== "error") {
      ownRecordingSeenRef.current = true;
      return;
    }
    // A retry begun from an error sees that same error until its own recording starts.
    if (recordingPhase === "error" && ownStartedInErrorRef.current && !ownRecordingSeenRef.current)
      return;
    ownRecordingSeenRef.current = false;
    settleMicrophone();
    // Dictation hands focus to the composer as it finishes.
    reclaimFocus();
  }, [recordingPhase, reclaimFocus]);

  // The microphone never started (voice input needs setup, was refused, or is no longer
  // available): close voice chat and leave any setup screen it opened alone.
  const micStalled =
    stage === "listening" &&
    !muted &&
    !waitingForThread &&
    recordingPhase === "idle" &&
    !sendFailed;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a microphone request that never began; cleared as soon as recording starts
  useEffect(() => {
    if (!micStalled) return;
    const timer = window.setTimeout(() => {
      // Nothing was ever recording, so there is nothing to cancel. Settling first tells a slow status
      // check not to open the microphone, yet leaves it free to open voice setup.
      settleMicrophone();
      const stalled = latest.current.bridge;
      if (stalled?.available !== true || stalled.needsSetup) {
        toastManager.add({
          id: "voice-chat-ended-no-input",
          type: "info",
          title: gt("Voice chat ended"),
          description: gt("Voice input is no longer available."),
          ...(stalled
            ? {
                actionProps: {
                  children: gt("Open Voice settings"),
                  onClick: () => openVoiceSettings(stalled, "voice-chat-ended-no-input"),
                },
              }
            : {}),
        });
      }
      dispatchVoiceSession({ type: "stop" });
    }, START_REFUSED_MS);
    return () => window.clearTimeout(timer);
  }, [micStalled, gt]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples the live microphone level each frame and writes the ring's swell as a transform, which React state would re-render on
  useEffect(() => {
    const detector = createSilenceDetector();
    const still = prefersReducedMotion();
    let lastNow: number | null = null;
    let frame = requestAnimationFrame(function tick(now) {
      let swellTarget = 0;
      if (stage === "listening" && recordingPhase === "recording" && ownsMicrophone()) {
        swellTarget = Math.min(1, voiceLevel.current * 1.15);
        if (detector.sample(voiceLevel.current, now)) submitRef.current();
      } else if (stage === "speaking") {
        speechPulseRef.current *= 0.9;
        const murmur = 0.16 + 0.1 * Math.sin(now / 90) * Math.sin(now / 370);
        swellTarget = Math.max(murmur, speechPulseRef.current);
      }
      const elapsed = lastNow === null ? 0 : (now - lastNow) / 1000;
      lastNow = now;
      const swell = smoothSwell(swellValueRef.current, swellTarget, elapsed);
      if (swell !== swellValueRef.current) {
        swellValueRef.current = swell;
        // The light field behind the ring follows the sound by opacity, which reduced motion keeps:
        // a fade is not movement, and it is the only sign that the microphone hears the person.
        if (glowRef.current) glowRef.current.style.opacity = (0.55 + 0.45 * swell).toFixed(3);
        if (!still) {
          if (swellRef.current) swellRef.current.style.transform = swellScale(swell, SWELL_REACH);
          const rings = haloRef.current?.children;
          if (rings) {
            for (let index = 0; index < HALO_REACH.length; index += 1) {
              const ring = rings[index];
              if (ring instanceof HTMLElement) {
                ring.style.transform = swellScale(swell, HALO_REACH[index] ?? 0);
              }
            }
          }
        }
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
    } else if (
      recordingPhase === "idle" &&
      (ownTurn === "open" || (threadRef !== null && ownTurn === "ended"))
    ) {
      // A run that ended before it started (cancelled) is still the question's turn.
      dispatchVoiceSession({ type: "working" });
    }
  }, [stage, ownTurn, recordingPhase, threadRef]);

  // A send that never starts a turn (nothing to send, no provider) must not leave the ring spinning.
  const sendStalled =
    stage === "sending" &&
    recordingPhase === "idle" &&
    (threadRef === null ? !isWorking : session.messageId === null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out a send that produced no turn; the timer is cleared when the turn starts
  useEffect(() => {
    if (!sendStalled) return;
    const timer = window.setTimeout(() => dispatchVoiceSession({ type: "failed" }), SEND_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [sendStalled]);

  // A question stuck in recording, transcription or cleanup has one deadline for the whole send,
  // counted from the moment it was sent and kept across the recorder's phases. It ends in an
  // error with Try again. The send timeout above only runs while the recorder is idle.
  const transcribing = stage === "sending" && session.messageId === null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gives up on a spoken question whose recorder operation never finishes; cleared when its request goes out or the session leaves sending
  useEffect(() => {
    if (!transcribing) return;
    const timer = window.setTimeout(() => {
      if (ownsMicrophone()) latest.current.bridge?.cancel();
      dispatchVoiceSession({ type: "failed", message: latest.current.tookTooLong });
    }, SEND_OPERATION_MS);
    return () => window.clearTimeout(timer);
  }, [transcribing]);

  // Once the request is out, the thread must show its run; transcription no longer applies.
  const awaitingRun = stage === "sending" && session.messageId !== null && ownTurn === "unknown";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gives up on a request the thread never shows; cleared when its run appears
  useEffect(() => {
    if (!awaitingRun) return;
    const timer = window.setTimeout(
      () => dispatchVoiceSession({ type: "failed", message: latest.current.notices.notAccepted }),
      SEND_ACCEPT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [awaitingRun]);

  // A queued question the person holds will not run, and a turn that vanished from the thread
  // after it was followed will not answer: both end the wait with a plain message.
  const turnHeld = (stage === "sending" || stage === "thinking") && ownTurn === "held";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the stage when the question's run is held in the queue
  useEffect(() => {
    if (turnHeld) {
      dispatchVoiceSession({ type: "failed", message: latest.current.notices.held });
    }
  }, [turnHeld]);
  const turnLost = stage === "thinking" && ownTurn === "unknown";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gives up on a followed turn that is gone from the thread; cleared if it returns
  useEffect(() => {
    if (!turnLost) return;
    const timer = window.setTimeout(
      () => dispatchVoiceSession({ type: "failed", message: latest.current.notices.lost }),
      TURN_LOST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [turnLost]);

  // A dropped connection keeps the last projection, so an open run stays open and nothing else
  // would end the wait. Only a thread that is not live starts the clock; a connected queue never does.
  const threadStatus = useThreadStatus(threadRef);
  const connectionLost =
    threadRef !== null &&
    (stage === "sending" || stage === "thinking") &&
    ownTurn === "open" &&
    threadTranscriptMayLag({ shellExists: true, status: threadStatus });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gives up on a followed turn whose thread stayed disconnected; cleared when the thread is live again
  useEffect(() => {
    if (!connectionLost) return;
    const timer = window.setTimeout(() => {
      // Read aloud like a reply, so the person hears why voice chat stopped waiting.
      dispatchVoiceSession({
        type: "replied",
        reply: {
          id: `connection-lost:${getVoiceSession().submission ?? ""}`,
          text: latest.current.notices.disconnected,
          runId: null,
          kind: "notice",
        },
      });
    }, RECONNECT_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [connectionLost]);

  // Sending or thinking: read the answer once the turn is over and it has finished streaming.
  // The finished answer can be seen without any frame that showed the thread working.
  // A turn that ends without one gets a short grace period, then voice chat listens again.
  const answerSettled =
    ownTurn === "ended" &&
    (stage === "thinking" || (stage === "sending" && recordingPhase === "idle"));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- waits for the finished answer to the question that was sent; the timer covers a turn that ends with nothing to read
  useEffect(() => {
    if (!answerSettled) return;
    if (answerReady && answerId !== null) {
      dispatchVoiceSession({
        type: "replied",
        reply: { id: answerId, text: answerText, runId: answerRunId },
      });
      return;
    }
    // A send that is still waiting to start a turn has its own timeout above.
    if (stage !== "thinking") return;
    const timer = window.setTimeout(
      () => dispatchVoiceSession({ type: "replied", reply: null }),
      REPLY_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [answerSettled, stage, answerReady, answerId, answerText, answerRunId]);

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
    /** The utterance this reading is waiting on; events of one it gave up on are ignored. */
    let active: SpeechSynthesisUtterance | null = null;
    let startWatch: number | undefined;
    let startDeadline: number | undefined;
    let deadline: number | undefined;
    let voicesWait: number | undefined;
    let onVoices: (() => void) | undefined;
    let sawBoundary = false;
    const sentenceTimers: number[] = [];
    const clearSentenceTimers = () => {
      for (const timer of sentenceTimers.splice(0)) window.clearTimeout(timer);
    };
    // Each word of the caption warms as the voice reaches it, and a long reply scrolls to keep it mid-box.
    const progress = captionRef.current
      ? createCaptionProgress(captionRef.current, (word) => {
          const box = captionRef.current;
          if (!box || box.scrollHeight <= box.clientHeight) return;
          const top =
            word.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
          box.scrollTop = Math.max(0, top - box.clientHeight / 2);
        })
      : null;
    const finish = () => {
      // A late event of this reading must not end another turn's.
      if (finished) return;
      finished = true;
      dispatchVoiceSession({ type: "spoken", replyId: spoken.id });
    };
    const speak = (retried: boolean) => {
      if (finished) return;
      window.clearTimeout(startWatch);
      window.clearTimeout(startDeadline);
      const utterance = new SpeechSynthesisUtterance(spoken.text);
      utterance.lang = replyLanguage(
        spoken.text,
        document.documentElement.lang || navigator.language,
      );
      applyVoiceChatStyle(utterance, synthesis.getVoices(), getVoiceChatStyle());
      let began = false;
      // The length-based deadline counts from the moment the engine begins, not from the hand-over.
      const begin = () => {
        if (finished || began || active !== utterance) return;
        began = true;
        window.clearTimeout(startWatch);
        window.clearTimeout(startDeadline);
        deadline = window.setTimeout(finish, speechDeadlineMs(spoken.text));
        // An engine that reports no word timing gets the caption warmed a sentence at a time.
        sentenceTimers.push(
          window.setTimeout(() => {
            if (sawBoundary) return;
            const starts = sentenceStarts(spoken.text);
            const times = estimatedSentenceTimesMs(spoken.text);
            starts.forEach((start, index) => {
              const wait = (times[index] ?? 0) - NO_TIMING_WAIT_MS;
              // A sentence the estimate says is already under way is warmed at once.
              if (wait <= 0) progress?.reachSentence(start, spoken.text);
              else {
                sentenceTimers.push(
                  window.setTimeout(() => progress?.reachSentence(start, spoken.text), wait),
                );
              }
            });
          }, NO_TIMING_WAIT_MS),
        );
      };
      const end = () => {
        if (active === utterance) finish();
      };
      utterance.onstart = begin;
      utterance.onboundary = (event) => {
        if (active !== utterance) return;
        speechPulseRef.current = 0.62;
        sawBoundary = true;
        clearSentenceTimers();
        progress?.reach(event.charIndex);
        begin();
      };
      utterance.onend = end;
      utterance.onerror = end;
      active = utterance;
      synthesis.cancel();
      synthesis.speak(utterance);
      // Some engines drop an utterance without any event. Idle and never started means it is not coming.
      startWatch = window.setTimeout(() => {
        if (began) return;
        if (synthesis.speaking) begin();
        else if (!synthesis.pending) finish();
      }, SPEECH_START_MS);
      // An engine that keeps the utterance queued and never starts it gets one more try. One that
      // started since the first check is speaking it, only its start event is late.
      startDeadline = window.setTimeout(() => {
        if (began) return;
        if (synthesis.speaking) {
          begin();
          return;
        }
        // The engine dropped it since the first check: there is nothing left to retry.
        if (retried || !synthesis.pending) {
          finish();
          return;
        }
        active = null;
        synthesis.cancel();
        speak(true);
      }, SPEECH_ENGINE_START_MS);
    };
    // The deep voice is chosen from the device's voice list, which is empty until the device reports it.
    if (getVoiceChatStyle() === "conqueror" && synthesis.getVoices().length === 0) {
      onVoices = () => {
        synthesis.removeEventListener("voiceschanged", onVoices as () => void);
        window.clearTimeout(voicesWait);
        speak(false);
      };
      synthesis.addEventListener("voiceschanged", onVoices);
      voicesWait = window.setTimeout(onVoices, VOICES_WAIT_MS);
    } else {
      speak(false);
    }
    return () => {
      finished = true;
      active = null;
      window.clearTimeout(startWatch);
      window.clearTimeout(startDeadline);
      window.clearTimeout(deadline);
      window.clearTimeout(voicesWait);
      clearSentenceTimers();
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
    // The stage covers the whole window, header and sidebar included, so everything outside the
    // path from the stage up to the page is made inert, except the toasts.
    const covered: HTMLElement[] = [];
    for (
      let node: HTMLElement | null = stageElement;
      node?.parentElement;
      node = node.parentElement
    ) {
      for (const sibling of node.parentElement.children) {
        const isToast =
          sibling.matches('[data-slot="toast-viewport"]') ||
          sibling.querySelector('[data-slot="toast-viewport"]') !== null;
        if (sibling instanceof HTMLElement && sibling !== node && !sibling.inert && !isToast) {
          covered.push(sibling);
        }
      }
      if (node.parentElement === document.body) break;
    }
    for (const element of covered) element.inert = true;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // One press, one action: a held key repeats keydown, and a repeat must not mute and unmute.
      if (event.repeat && (event.key === "m" || event.key === "M" || event.key === "Escape")) {
        event.preventDefault();
        return;
      }
      if (event.key === "m" || event.key === "M") {
        const target = event.target;
        const typing =
          target instanceof HTMLElement &&
          (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
        if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
        event.preventDefault();
        dispatchVoiceSession({ type: "muted", muted: !getVoiceSession().muted });
        return;
      }
      if (event.key !== "Escape") return;
      // Escape always ends voice chat: the stage covers the window and makes the page behind inert,
      // so nothing else on screen is open for it to close first.
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

  // Until the answer streams in, the question that was asked stays on screen, so waiting has a subject.
  const askedText =
    messages.find(
      (message) =>
        message.role === "user" &&
        session.messageId !== null &&
        (message.messageId ?? message.id) === session.messageId,
    )?.text ?? "";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the question's own text in the session, so the caption does not swap back to the microphone's partial words when the thread's row comes and goes
  useEffect(() => {
    if (askedText.length > 0) dispatchVoiceSession({ type: "asked", text: askedText });
  }, [askedText]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the brief "Interrupted" state; bounded, and cleared if the stage closes first
  useEffect(() => {
    if (!interrupted) return;
    const timer = window.setTimeout(() => setInterrupted(false), INTERRUPTED_MS);
    return () => window.clearTimeout(timer);
  }, [interrupted]);

  // No toast shows over the stage, whatever it is: they wait in the queue and come when it closes.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the shared toast queue while this stage is open
  useEffect(() => {
    setToastsSuppressed(true);
    return () => {
      // The exit beat is still on screen: its ghost lets the toasts go when it ends. This is the
      // fallback for a screen that left with no ghost to do it.
      const timer = window.setTimeout(() => {
        if (getVoiceSession().stage === "off" && getVoiceExit() === null)
          setToastsSuppressed(false);
      }, 1_500);
      if (getVoiceExit() === null) {
        window.clearTimeout(timer);
        setToastsSuppressed(false);
      }
    };
  }, []);

  // The key hints show faintly, fade after a few seconds without input, and return on any key or
  // pointer move. After a few sessions they stay hidden until the person reaches for the keys or
  // the pointer. The count is local to this browser. The attribute is written directly: a change of
  // it is a fade, and no React render should wait on a timer.
  const hintsCountedRef = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fades the key hints on a timer and brings them back on input; the attribute lives on the stage element
  useEffect(() => {
    const stageElement = stageRef.current;
    if (!stageRendered || !stageElement) return;
    let seen = 0;
    try {
      seen = Number(window.localStorage.getItem(HINT_SESSIONS_KEY) ?? 0) || 0;
      if (!hintsCountedRef.current) {
        hintsCountedRef.current = true;
        window.localStorage.setItem(HINT_SESSIONS_KEY, String(seen + 1));
      }
    } catch {
      // Without storage the hints behave like the first session.
    }
    let timer: number | undefined;
    const show = () => {
      stageElement.dataset.hints = "on";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        stageElement.dataset.hints = "off";
      }, HINTS_VISIBLE_MS);
    };
    if (seen >= HINT_SESSIONS_SHOWN) stageElement.dataset.hints = "off";
    else show();
    const events = ["keydown", "pointermove", "pointerdown"] as const;
    for (const type of events) window.addEventListener(type, show, true);
    return () => {
      window.clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, show, true);
    };
  }, [stageRendered]);

  // The ring arrives from the control that opened voice chat and, when voice chat ends, flies back:
  // one motion each way. A layout effect, so the first painted frame is already the start of it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the arrival animation on the committed ring and records where to fly back to on exit
  useLayoutEffect(() => {
    const orbWrap = orbWrapRef.current;
    const stageElement = stageRef.current;
    if (!stageRendered || !orbWrap || !stageElement) return;
    // The control that opened voice chat, or else what had focus (the composer, for the shortcut).
    // Read once: a development re-run of this effect must find the same one.
    if (originRef.current === undefined) {
      const active = document.activeElement;
      originRef.current =
        takeVoiceLauncher() ??
        (active instanceof HTMLElement && active !== document.body && !stageElement.contains(active)
          ? active
          : null);
    }
    const origin = originRef.current;
    clearVoiceExit();
    preloadExitMark(256);
    const stageBox = boxOf(stageElement);
    const fallback = {
      left: stageBox.left + stageBox.width / 2 - 24,
      top: stageBox.top + stageBox.height - 64,
      width: 48,
      height: 48,
    };
    const reduced = prefersReducedMotion();
    // Where the ring rests and where it came from, kept current while the stage is open: the exit
    // then renders in the very commit that closes the stage, with no frame between the two.
    let resting = boxOf(orbWrap);
    const keepPlan = () => {
      if (reduced) return;
      const returnTo = origin?.isConnected === true ? boxOf(origin) : null;
      holdVoiceExit({ orb: resting, origin: returnTo });
    };
    keepPlan();
    let arrival: Animation | null = null;
    if (!reduced) {
      const flight = flightTransform(flightTo(resting, origin ? boxOf(origin) : fallback));
      arrival = orbWrap.animate(
        [
          { transform: flight, opacity: 0 },
          { opacity: 1, offset: 0.4 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: motionMs(stageElement, "--mo-sheet", 320),
          easing: motionToken(stageElement, "--ease-enter", EASE_ENTER_FALLBACK),
        },
      );
    }
    const remeasure = () => {
      if (arrival?.playState === "running") return;
      resting = boxOf(orbWrap);
      keepPlan();
    };
    window.addEventListener("resize", remeasure);
    return () => {
      arrival?.cancel();
      window.removeEventListener("resize", remeasure);
      // Left the screen with voice chat still on: there is nothing to fly back from.
      if (getVoiceSession().stage !== "off") clearVoiceExit();
      else expireVoiceExit();
    };
  }, [stageRendered]);

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
  const isNotice = stage === "speaking" && session.reply?.kind === "notice";
  const look: VoiceLook =
    stage === "speaking"
      ? isNotice
        ? "notice"
        : "speaking"
      : stage === "listening"
        ? micFailed || unavailable
          ? "failed"
          : interrupted
            ? "interrupted"
            : waitingForThread
              ? "thinking"
              : muted
                ? "muted"
                : preparing
                  ? "preparing"
                  : "listening"
        : "thinking";
  const status = micFailed
    ? gt("Voice input stopped")
    : waitingForThread
      ? gt("Waiting for the current reply")
      : unavailable
        ? gt("Voice input is not available")
        : look === "interrupted"
          ? gt("Interrupted")
          : look === "muted"
            ? gt("Muted")
            : look === "notice"
              ? gt("Connection lost")
              : stage === "listening"
                ? preparing
                  ? gt("Getting the microphone ready")
                  : gt("Listening")
                : stage === "speaking"
                  ? gt("Speaking")
                  : gt("Thinking");
  const waitingCaption = session.heard || bridge.heard;
  const caption =
    stage === "listening"
      ? (micError ?? bridge.heard)
      : stage === "speaking"
        ? (session.reply?.text ?? "")
        : answerText.length > 0
          ? answerText
          : waitingCaption;
  const captionIsQuestion =
    stage === "listening"
      ? micError === null
      : (stage === "sending" || stage === "thinking") && answerText.length === 0;
  const orbLabel =
    stage === "listening"
      ? muted
        ? gt("Unmute microphone")
        : gt("Send what I said")
      : stage === "speaking"
        ? isNotice
          ? gt("Dismiss and listen")
          : gt("Stop reading and listen")
        : gt("Waiting for the reply");
  const orbAction =
    stage === "listening"
      ? muted
        ? "unmute"
        : bridge.phase === "recording" && ownsMicrophone()
          ? "send"
          : null
      : stage === "speaking" && !isNotice
        ? "interrupt"
        : null;

  const toggleMute = () => dispatchVoiceSession({ type: "muted", muted: !muted });
  const onOrbPress = () => {
    if (stage === "listening" && muted) toggleMute();
    else if (stage === "listening" && bridge.phase === "recording" && ownsMicrophone()) submit();
    else if (stage === "speaking") {
      if (!isNotice) setInterrupted(true);
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
    <VoiceStageView
      look={look}
      stage={stage}
      status={status}
      orbLabel={orbLabel}
      orbDisabled={stage === "sending" || stage === "thinking"}
      caption={caption}
      captionKind={captionIsQuestion ? "heard" : "reply"}
      muted={muted}
      showRetry={micFailed}
      orbAction={orbAction}
      glowRef={glowRef}
      glowLevelRef={swellValueRef}
      captionRef={captionRef}
      captionWords={stage === "speaking"}
      stageRef={stageRef}
      orbButtonRef={orbButtonRef}
      orbWrapRef={orbWrapRef}
      swellRef={swellRef}
      haloRef={haloRef}
      onOrb={onOrbPress}
      onRetry={retry}
      onToggleMute={toggleMute}
      onEnd={() => dispatchVoiceSession({ type: "stop" })}
    />
  );
}
