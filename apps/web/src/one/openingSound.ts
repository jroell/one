/**
 * The sound of the opening: a low swell that opens as the ring ignites, then
 * one soft glass tone as it settles. Synthesized, so there is no file to load.
 * Browsers only allow sound after a user gesture; when the page may not play,
 * this stays silent rather than waiting and sounding late.
 */
/** How long the browser may hold the sound before the opening goes on without it. */
const RESUME_DEADLINE_MS = 600;
/** How long an unlocked context waits for the opening to take it before it is closed. */
const UNLOCK_HOLD_MS = 5000;

let unlocked: { readonly context: AudioContext; readonly expiry: number } | null = null;

function audioContextClass(): typeof AudioContext | undefined {
  return typeof window === "undefined" ? undefined : window.AudioContext;
}

/**
 * Creates and resumes the audio context. Call it inside the click or key press that asks for a
 * replay: some browsers unlock audio only during a user gesture, and the opening starts its
 * sound later, in an effect, where the gesture is gone. The next `playOpeningSound` takes this
 * context; one nobody takes is closed after a few seconds.
 */
export function unlockOpeningSound(): void {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return;
  try {
    if (!unlocked) {
      const context = new AudioContextClass();
      const expiry = window.setTimeout(() => {
        if (unlocked?.context !== context) return;
        unlocked = null;
        void context.close().catch(() => {});
      }, UNLOCK_HOLD_MS);
      unlocked = { context, expiry };
    }
    void unlocked.context.resume().catch(() => {});
  } catch {
    // The opening plays silently when the browser refuses audio.
  }
}

function takeUnlockedContext(): AudioContext | null {
  if (!unlocked) return null;
  const { context, expiry } = unlocked;
  unlocked = null;
  window.clearTimeout(expiry);
  return context.state === "closed" ? null : context;
}

export function playOpeningSound(ignitionSeconds: number): () => void {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return () => {};
  let context: AudioContext;
  try {
    context = takeUnlockedContext() ?? new AudioContextClass();
  } catch {
    return () => {};
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    void context.close().catch(() => {});
  };
  let stop = close;
  const begin = () => {
    if (!closed) stop = scheduleOpeningSound(context, ignitionSeconds, close);
  };
  if (context.state === "running") {
    begin();
  } else {
    // No gesture yet, so the browser holds the sound. Start only if it lets go
    // while the opening is still young; a late sound would land on the app.
    const asked = performance.now();
    void context
      .resume()
      .then(() => (performance.now() - asked < RESUME_DEADLINE_MS ? begin() : close()))
      .catch(close);
    // A page that is never allowed to play would otherwise keep the context open for good.
    window.setTimeout(() => {
      if (context.state !== "running") close();
    }, RESUME_DEADLINE_MS);
  }
  return () => stop();
}

function scheduleOpeningSound(
  context: AudioContext,
  ignitionSeconds: number,
  close: () => void,
): () => void {
  const start = context.currentTime + 0.05;
  const master = context.createGain();
  master.gain.value = 0.0001;
  master.connect(context.destination);

  // A short feedback delay gives the tones a hall-like tail.
  const delay = context.createDelay(1);
  delay.delayTime.value = 0.33;
  const feedback = context.createGain();
  feedback.gain.value = 0.34;
  const tailTone = context.createBiquadFilter();
  tailTone.type = "lowpass";
  tailTone.frequency.value = 1800;
  delay.connect(tailTone).connect(feedback).connect(delay);
  tailTone.connect(master);

  // The swell: a root, its fifth and an octave, opening through a filter.
  const swellFilter = context.createBiquadFilter();
  swellFilter.type = "lowpass";
  swellFilter.Q.value = 0.6;
  swellFilter.frequency.setValueAtTime(90, start);
  swellFilter.frequency.exponentialRampToValueAtTime(720, start + ignitionSeconds);
  swellFilter.frequency.exponentialRampToValueAtTime(140, start + ignitionSeconds + 3);
  const swell = context.createGain();
  swell.gain.setValueAtTime(0.0001, start);
  swell.gain.exponentialRampToValueAtTime(0.5, start + ignitionSeconds * 0.85);
  swell.gain.exponentialRampToValueAtTime(0.0001, start + ignitionSeconds + 3.2);
  swellFilter.connect(swell).connect(master);
  const voices: ReadonlyArray<readonly [OscillatorType, number, number]> = [
    ["sine", 73.42, 0.9],
    ["sine", 110.3, 0.5],
    ["triangle", 146.6, 0.22],
    ["sawtooth", 36.71, 0.1],
  ];
  const end = start + ignitionSeconds + 4.4;
  for (const [type, frequency, level] of voices) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = level;
    oscillator.connect(gain).connect(swellFilter);
    oscillator.start(start);
    oscillator.stop(end);
  }

  // The glass tone, as the flame closes the circle.
  const strike = start + ignitionSeconds * 0.72;
  const partials: ReadonlyArray<readonly [number, number, number]> = [
    [587.33, 0.16, 3.4],
    [880.0, 0.09, 2.6],
    [1174.66, 0.05, 1.9],
    [1760.0, 0.02, 1.2],
  ];
  for (const [frequency, level, decay] of partials) {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, strike);
    gain.gain.exponentialRampToValueAtTime(level, strike + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, strike + decay);
    oscillator.connect(gain);
    gain.connect(master);
    gain.connect(delay);
    oscillator.start(strike);
    oscillator.stop(strike + decay + 0.1);
  }

  master.gain.exponentialRampToValueAtTime(0.2, start + 0.4);
  master.gain.setValueAtTime(0.2, end - 0.6);
  master.gain.exponentialRampToValueAtTime(0.0001, end);
  const timer = window.setTimeout(close, (end - context.currentTime + 0.3) * 1000);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    // Fade instead of cutting, so skipping the opening does not click.
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    window.setTimeout(close, 450);
  };
}
