import { useGT } from "gt-react";
import { MicIcon, MicOffIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { OneOrb, type OneOrbState } from "./OneOrb";
import { captionWords } from "./voiceCaptionProgress";
import {
  EASE_ENTER_FALLBACK,
  EASE_EXIT_FALLBACK,
  EXIT_RATIO,
  motionMs,
  motionToken,
  prefersReducedMotion,
} from "./voiceStageMotion";

/**
 * What the stage shows. Each one has its own shape and word, so none is told apart by sound or by
 * color alone.
 */
export type VoiceLook =
  | "preparing"
  | "listening"
  | "muted"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "notice"
  | "failed";

/**
 * The ring is the mark: a rigid gold torus. It rests at its fixed tilt, and while the agent works
 * it is held edge-on with one light sweeping across it. The listening and speaking poses face the
 * viewer, so voice chat does not use them; sound reaches the ring only through `glowLevelRef`,
 * which drives its rim and halo and never its shape.
 */
const ORB_STATE: Record<VoiceLook, OneOrbState> = {
  preparing: "idle",
  listening: "idle",
  muted: "idle",
  thinking: "waiting",
  speaking: "idle",
  interrupted: "idle",
  notice: "idle",
  failed: "idle",
};

export type VoiceStageViewProps = {
  readonly look: VoiceLook;
  readonly stage: string;
  readonly status: string;
  readonly orbLabel: string;
  readonly orbDisabled: boolean;
  readonly caption: string;
  readonly captionKind: "heard" | "reply";
  /** Words are separate elements, so the voice can warm them one by one while it speaks. */
  readonly captionWords: boolean;
  readonly muted: boolean;
  readonly showRetry: boolean;
  /** What the orb does right now, for the key hint: null when it does nothing. */
  readonly orbAction: "send" | "interrupt" | "unmute" | null;
  readonly glowRef: RefObject<HTMLDivElement | null>;
  /** The disc the dark stage grows from when it opens. */
  readonly irisRef: RefObject<HTMLDivElement | null>;
  /** The stage's own backdrop: it fades in over the disc once the disc has covered the window. */
  readonly backdropRef: RefObject<HTMLDivElement | null>;
  /** The smoothed sound level, 0 to 1, for the ring's own rim and halo glow. */
  readonly glowLevelRef: { readonly current: number };
  readonly captionRef: RefObject<HTMLParagraphElement | null>;
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly orbButtonRef: RefObject<HTMLButtonElement | null>;
  readonly orbWrapRef: RefObject<HTMLDivElement | null>;
  readonly swellRef: RefObject<HTMLDivElement | null>;
  readonly haloRef: RefObject<HTMLDivElement | null>;
  readonly onOrb: () => void;
  readonly onRetry: () => void;
  readonly onToggleMute: () => void;
  readonly onEnd: () => void;
};

const CaptionText = memo(function CaptionText({
  text,
  words,
}: {
  readonly text: string;
  readonly words: boolean;
}) {
  if (!words) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const word of captionWords(text)) {
    if (word.start > cursor) parts.push(text.slice(cursor, word.start));
    parts.push(
      <span key={word.start} className="one-voice-word" data-start={word.start}>
        {word.text}
      </span>,
    );
    cursor = word.start + word.text.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
});

/**
 * One serif italic word under the ring. A new word fades in while the old one fades out in the same
 * place, so a change of state is seen, not swapped. Screen readers get only the current word.
 */
function StatusWord({ status }: { readonly status: string }) {
  const [words, setWords] = useState({ current: status, previous: null as string | null, turn: 0 });
  if (words.current !== status) {
    setWords({ current: status, previous: words.current, turn: words.turn + 1 });
  }
  return (
    <div className="one-voice-status-wrap" data-swapping={words.previous === null ? undefined : ""}>
      {words.previous === null ? null : (
        <span key={`out-${words.turn}`} className="one-voice-status-out" aria-hidden="true">
          {words.previous}
        </span>
      )}
      {/* One live region for the whole stay, so a new word is announced as a change of its text. */}
      <p className="one-voice-status-slot" role="status" aria-live="polite">
        <span key={`in-${words.turn}`} className="one-voice-status">
          {words.current}
        </span>
      </p>
    </div>
  );
}

/**
 * When the transcript changes what it is (the question, the reply, a notice, nothing), the old text
 * fades out first and the new text comes in after it, on the same two beats as the status word. Text
 * that only grows (a reply streaming in) is left alone.
 */
function useCaptionSwap(
  captionRef: RefObject<HTMLParagraphElement | null>,
  leavingRef: RefObject<HTMLParagraphElement | null>,
  kind: string,
  caption: string,
): {
  readonly previous: { readonly text: string; readonly kind: string } | null;
  readonly turn: number;
} {
  const key = `${kind}:${caption.length > 0}`;
  const [exitedTurn, setExitedTurn] = useState(0);
  const [seen, setSeen] = useState({
    key,
    text: caption,
    kind,
    previous: null as { text: string; kind: string } | null,
    turn: 0,
  });
  if (seen.key !== key) {
    setSeen({
      key,
      text: caption,
      kind,
      previous: { text: seen.text, kind: seen.kind },
      turn: seen.turn + 1,
    });
  } else if (seen.text !== caption) {
    setSeen({ ...seen, text: caption });
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays the old transcript's exit and removes its copy when it ends, then starts the new one's entrance
  useLayoutEffect(() => {
    const element = captionRef.current;
    const leaving = leavingRef.current;
    if (!element || seen.turn === 0) return;
    const quick = motionMs(element, "--mo-quick", 180);
    const exit = leaving?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: quick * EXIT_RATIO,
      easing: motionToken(element, "--ease-exit", EASE_EXIT_FALLBACK),
      fill: "forwards",
    });
    let cancelled = false;
    void exit?.finished.then(
      () => {
        if (!cancelled) setExitedTurn(seen.turn);
      },
      () => undefined,
    );
    if (!leaving) setExitedTurn(seen.turn);
    if (prefersReducedMotion()) {
      return () => {
        cancelled = true;
        exit?.cancel();
      };
    }
    const entrance = element.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: quick,
        delay: quick * EXIT_RATIO,
        easing: motionToken(element, "--ease-enter", EASE_ENTER_FALLBACK),
        fill: "backwards",
      },
    );
    return () => {
      cancelled = true;
      exit?.cancel();
      entrance.cancel();
    };
  }, [seen.turn, captionRef, leavingRef]);
  return {
    previous: exitedTurn === seen.turn ? null : seen.previous,
    turn: seen.turn,
  };
}

function Control({
  label,
  name,
  shortcut,
  pressed,
  onClick,
  children,
}: {
  /** What hovering or focusing shows. */
  readonly label: string;
  /** The accessible name; it stays the same when the control is pressed. */
  readonly name: string;
  readonly shortcut?: string;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="one-voice-control"
      aria-label={name}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {children}
      <span className="one-voice-control-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

/** The voice stage as drawn: a dark scene, the ring as the orb, its state, the transcript and the controls. */
export function VoiceStageView({
  look,
  stage,
  status,
  orbLabel,
  orbDisabled,
  caption,
  captionKind,
  captionWords: wordsEnabled,
  muted,
  showRetry,
  orbAction,
  glowRef,
  irisRef,
  backdropRef,
  glowLevelRef,
  captionRef,
  stageRef,
  orbButtonRef,
  orbWrapRef,
  swellRef,
  haloRef,
  onOrb,
  onRetry,
  onToggleMute,
  onEnd,
}: VoiceStageViewProps) {
  const gt = useGT();
  const hasCaption = caption.length > 0;
  const leavingRef = useRef<HTMLParagraphElement | null>(null);
  const swap = useCaptionSwap(captionRef, leavingRef, captionKind, caption);
  const eyebrow = !hasCaption
    ? null
    : captionKind === "heard"
      ? gt("You said")
      : look === "notice"
        ? gt("Connection")
        : gt("Reply");
  const orbHint =
    orbAction === "send"
      ? gt("Send")
      : orbAction === "interrupt"
        ? gt("Interrupt")
        : orbAction === "unmute"
          ? gt("Unmute")
          : null;
  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-label={gt("Voice chat")}
      data-one-voice-stage={stage}
      data-look={look}
      data-hints="on"
      className="one-voice-stage"
    >
      <div ref={irisRef} className="one-voice-iris" aria-hidden="true" />
      <div ref={backdropRef} className="one-voice-backdrop" aria-hidden="true" />
      <div className="one-voice-drag" aria-hidden="true" />
      <div className="one-voice-stage-body">
        <div ref={orbWrapRef} className="one-voice-orb-wrap">
          <div className="one-voice-glow" aria-hidden="true">
            <div ref={glowRef} className="one-voice-glow-pulse" />
          </div>
          <div ref={haloRef} className="one-voice-halo" aria-hidden="true">
            <span className="one-voice-ring" />
            <span className="one-voice-ripple" />
          </div>
          <div ref={swellRef} className="one-voice-orb-swell">
            <button
              ref={orbButtonRef}
              type="button"
              className="one-voice-orb-button"
              aria-label={orbLabel}
              aria-disabled={orbDisabled}
              onClick={onOrb}
            >
              <OneOrb state={ORB_STATE[look]} glowLevelRef={glowLevelRef} className="w-full" />
            </button>
          </div>
        </div>
        <StatusWord status={status} />
        <span
          key={`${captionKind}:${hasCaption}`}
          className="one-voice-eyebrow one-voice-caption-line"
          aria-hidden="true"
        >
          {eyebrow}
        </span>
        <div className="one-voice-caption-wrap">
          {swap.previous === null || swap.previous.text.length === 0 ? null : (
            <p
              key={`out-${swap.turn}`}
              ref={leavingRef}
              className="one-voice-caption-out"
              data-kind={swap.previous.kind}
              aria-hidden="true"
            >
              {swap.previous.text}
            </p>
          )}
          <p
            ref={captionRef}
            className="one-voice-caption"
            data-kind={captionKind}
            role="region"
            aria-label={gt("Voice chat transcript")}
            tabIndex={hasCaption ? 0 : undefined}
          >
            <CaptionText text={caption} words={wordsEnabled} />
          </p>
        </div>
      </div>
      <div className="one-voice-stage-actions">
        {showRetry ? (
          <Control
            name={gt("Try the microphone again")}
            label={gt("Try the microphone again")}
            onClick={onRetry}
          >
            <RotateCcwIcon aria-hidden="true" />
          </Control>
        ) : null}
        <Control
          name={gt("Mute microphone")}
          label={muted ? gt("Unmute microphone") : gt("Mute microphone")}
          shortcut="M"
          pressed={muted}
          onClick={onToggleMute}
        >
          {muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        </Control>
        <Control
          name={gt("End voice chat")}
          label={gt("End voice chat")}
          shortcut="Escape"
          onClick={onEnd}
        >
          <XIcon aria-hidden="true" />
        </Control>
      </div>
      <ul className="one-voice-hints" aria-label={gt("Keyboard shortcuts")}>
        {orbHint === null ? null : (
          <li>
            <kbd>{gt("Space")}</kbd>
            {orbHint}
          </li>
        )}
        <li>
          <kbd>M</kbd>
          {muted ? gt("Unmute") : gt("Mute")}
        </li>
        <li>
          <kbd>Esc</kbd>
          {gt("End")}
        </li>
      </ul>
    </div>
  );
}
