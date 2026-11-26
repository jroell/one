import { ORB_MARK_DENSITIES, orbMarkUrl } from "./oneOrbRest";

/** How far the ring swells at full sound, as a scale added to 1. */
export const SWELL_REACH = 0.08;
/** How far the halo hairline follows the swell. */
export const HALO_REACH = [0.09] as const;
/**
 * Seconds the swell takes to rise toward a louder sound, and to fall back after it. The microphone
 * level is already smoothed and arrives 20 times a second; this carries it between samples.
 */
const SWELL_ATTACK_S = 0.04;
const SWELL_RELEASE_S = 0.12;
/** A change smaller than this is not worth a style write. */
const SWELL_DEADBAND = 0.002;

/**
 * Moves the swell toward the sound level: quickly up, slowly down, by elapsed time so the result
 * does not depend on the frame rate. A long gap (a hidden tab) counts as one short frame.
 */
export function smoothSwell(current: number, target: number, elapsedSeconds: number): number {
  const dt = Math.min(0.05, Math.max(0, elapsedSeconds));
  const tau = target > current ? SWELL_ATTACK_S : SWELL_RELEASE_S;
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(next - current) < SWELL_DEADBAND && Math.abs(next - target) < SWELL_DEADBAND
    ? target
    : next;
}

export function swellScale(swell: number, reach: number): string {
  return `scale(${(1 + Math.min(1, Math.max(0, swell)) * reach).toFixed(4)})`;
}

type Box = Readonly<{ left: number; top: number; width: number; height: number }>;

/**
 * The transform that carries the orb from where it rests to the control that opened voice chat,
 * as a translation of centers and a scale of sizes. Run it forward to leave and backward to arrive.
 */
export function flightTo(orb: Box, origin: Box): { dx: number; dy: number; scale: number } {
  const scale = Math.min(0.4, Math.max(0.05, Math.min(origin.width, origin.height) / orb.width));
  return {
    dx: origin.left + origin.width / 2 - (orb.left + orb.width / 2),
    dy: origin.top + origin.height / 2 - (orb.top + orb.height / 2),
    scale,
  };
}

export function flightTransform(flight: { dx: number; dy: number; scale: number }): string {
  return `translate(${flight.dx.toFixed(1)}px, ${flight.dy.toFixed(1)}px) scale(${flight.scale.toFixed(3)})`;
}

/** Reads a motion token from the stage, falling back to the contract's value when it is not defined yet. */
export function motionToken(element: Element, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

export function motionMs(element: Element, name: string, fallbackMs: number): number {
  const raw = motionToken(element, name, `${fallbackMs}ms`);
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallbackMs;
  return raw.endsWith("ms") ? value : value * 1000;
}

export const EASE_ENTER_FALLBACK = "cubic-bezier(0.2, 0.9, 0.1, 1)";
export const EASE_EXIT_FALLBACK = "cubic-bezier(0.4, 0, 1, 1)";
/** The contract's exit duration is the enter duration times this. */
export const EXIT_RATIO = 0.7;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Where the orb sat and where voice chat was opened from, kept so leaving can fly back. */
export type VoiceExitPlan = Readonly<{ orb: Box; origin: Box | null }>;

let pendingExit: VoiceExitPlan | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const exitListeners = new Set<() => void>();

function setExit(plan: VoiceExitPlan | null): void {
  pendingExit = plan;
  for (const listener of exitListeners) listener();
}

/** Holds the plan for the exit beat while the stage is open, so the exit renders in the commit that closes it. */
export function holdVoiceExit(plan: VoiceExitPlan): void {
  clearTimeout(expiry);
  setExit(plan);
}

/** The stage is gone and the exit beat has begun or will not: a plan nobody picks up expires. */
export function expireVoiceExit(): void {
  clearTimeout(expiry);
  expiry = setTimeout(() => setExit(null), 1_000);
}

export function clearVoiceExit(): void {
  clearTimeout(expiry);
  if (pendingExit !== null) setExit(null);
}

export function subscribeVoiceExit(listener: () => void): () => void {
  exitListeners.add(listener);
  return () => exitListeners.delete(listener);
}

export function getVoiceExit(): VoiceExitPlan | null {
  return pendingExit;
}

let preloaded: HTMLImageElement | null = null;

/**
 * Fetches and decodes the flat ring the exit flies home with while the stage is still open, so the
 * ghost paints it in its first frame instead of fetching it mid-exit.
 */
export function preloadExitMark(size: 256): void {
  if (preloaded !== null) return;
  const image = new Image();
  image.srcset = ORB_MARK_DENSITIES.map(
    (density) => `${orbMarkUrl("dark", size, density)} ${density}x`,
  ).join(", ");
  image.src = orbMarkUrl("dark", size, 1);
  preloaded = image;
  void image.decode().catch(() => undefined);
}

let launcher: Element | null = null;

/** The control that is opening voice chat, noted at the click: Safari does not focus a clicked button. */
export function rememberVoiceLauncher(element: Element | null): void {
  launcher = element;
}

export function takeVoiceLauncher(): Element | null {
  const element = launcher;
  launcher = null;
  return element?.isConnected === true ? element : null;
}

export function boxOf(element: Element): Box {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}
