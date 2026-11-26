import { useGT } from "gt-react";
import {
  HandIcon,
  MicIcon,
  MicOffIcon,
  TriangleAlertIcon,
  Volume2Icon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { OneOrb, type OneOrbState } from "./OneOrb";

/**
 * What the stage shows. Each one has its own shape, label and glyph, so none is told apart by
 * sound or by color alone.
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
 * The ring is the mark: a rigid gold torus at its fixed tilt. Only thinking leaves that pose, by
 * turning about its own axis, which keeps every frame a clean torus. The listening and speaking
 * poses face the viewer and deform the band with the sound level, so voice chat does not use them.
 */
const ORB_STATE: Record<VoiceLook, OneOrbState> = {
  preparing: "idle",
  listening: "idle",
  muted: "idle",
  thinking: "thinking",
  speaking: "idle",
  interrupted: "idle",
  notice: "idle",
  failed: "idle",
};

const GLYPHS: Record<VoiceLook, ReactNode> = {
  preparing: <MicIcon />,
  listening: <MicIcon />,
  muted: <MicOffIcon />,
  thinking: (
    <svg viewBox="0 0 16 16" data-glyph="working">
      <circle cx="8" cy="8" r="6" pathLength="100" strokeDasharray="75 25" />
    </svg>
  ),
  speaking: <Volume2Icon />,
  interrupted: <HandIcon />,
  notice: <WifiOffIcon />,
  failed: <TriangleAlertIcon />,
};

export type VoiceStageViewProps = {
  readonly look: VoiceLook;
  readonly stage: string;
  readonly status: string;
  readonly orbLabel: string;
  readonly orbDisabled: boolean;
  readonly caption: string;
  readonly captionKind: "heard" | "reply";
  readonly muted: boolean;
  readonly showRetry: boolean;
  /** What the orb does right now, for the key hint: null when it does nothing. */
  readonly orbAction: "send" | "interrupt" | "unmute" | null;
  readonly glowRef: RefObject<HTMLDivElement | null>;
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

/** The voice stage as drawn: a dark scene, the ring as the orb, its state, the transcript and the controls. */
export function VoiceStageView({
  look,
  stage,
  status,
  orbLabel,
  orbDisabled,
  caption,
  captionKind,
  muted,
  showRetry,
  orbAction,
  glowRef,
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
      className="one-voice-stage"
    >
      <div className="one-voice-drag" aria-hidden="true" />
      <div className="one-voice-stage-body">
        <div ref={orbWrapRef} className="one-voice-orb-wrap">
          <div className="one-voice-glow" aria-hidden="true">
            <div ref={glowRef} className="one-voice-glow-pulse" />
          </div>
          <div ref={haloRef} className="one-voice-halo" aria-hidden="true">
            <span className="one-voice-ring" />
            <span className="one-voice-ring" />
            <span className="one-voice-ring" />
            <span className="one-voice-ripple" />
            <span className="one-voice-ripple" />
            <svg className="one-voice-arc" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="48" pathLength="100" strokeDasharray="75 25" />
            </svg>
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
              <OneOrb state={ORB_STATE[look]} className="w-full" />
            </button>
          </div>
        </div>
        <p className="one-voice-status" role="status" aria-live="polite">
          <span className="one-voice-status-glyph" aria-hidden="true">
            {GLYPHS[look]}
          </span>
          <span key={look} className="one-voice-status-text">
            {status}
          </span>
        </p>
        <span
          key={captionKind}
          className="one-voice-eyebrow one-voice-caption-line"
          aria-hidden="true"
        >
          {eyebrow}
        </span>
        <p
          className="one-voice-caption"
          data-kind={captionKind}
          role="region"
          aria-label={gt("Voice chat transcript")}
          tabIndex={hasCaption ? 0 : undefined}
        >
          {caption}
        </p>
      </div>
      <div className="one-voice-stage-actions">
        {showRetry ? (
          <button type="button" className="one-voice-action" onClick={onRetry}>
            {gt("Try the microphone again")}
          </button>
        ) : null}
        <button
          type="button"
          className="one-voice-action"
          aria-pressed={muted}
          onClick={onToggleMute}
        >
          {muted ? <MicIcon aria-hidden="true" /> : <MicOffIcon aria-hidden="true" />}
          {gt("Mute microphone")}
        </button>
        <button type="button" className="one-voice-action" onClick={onEnd}>
          <XIcon aria-hidden="true" />
          {gt("End voice chat")}
        </button>
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
