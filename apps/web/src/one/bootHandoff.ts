/**
 * Hands the boot ring to the app as one motion: a copy of the boot card flies to the app's ring
 * (the home ring, else the sidebar lockup with its wordmark). Transform and opacity only, no
 * input taken, and under reduced motion a plain crossfade.
 */
const EASE = "cubic-bezier(0.2, 0.9, 0.1, 1)";
const TRAVEL_MS = 560;
/** On home the title leaves in this long, and the app (with its own wordmark) fades in after it (one-pages.css). */
const NAME_LEAVE_MS = 120;
/** How long the ring waits for a target that went away mid-flight before it fades out. */
const TARGET_WAIT_MS = 1500;
/** How long to wait for the app to draw a ring to fly to before the boot ring just fades. */
const WAIT_MS = 500;
/** The home screen draws its ring after its data arrives, so it gets longer before the lockup. */
const HOME_WAIT_MS = 1500;
/** After this long without a target the app shows anyway, under the waiting ring. */
const SHOW_APP_MS = 300;

export interface BootGhost {
  readonly layer: HTMLElement;
  readonly ring: HTMLElement;
  readonly name: HTMLElement | null;
  readonly from: DOMRect;
  /** What the boot ring and name showed when captured: a fast boot hands off almost nothing. */
  readonly ringShown: {
    readonly opacity: string;
    readonly transform: string;
    readonly rotate: string;
  };
  readonly nameOpacity: string;
}

/** Copies the boot card to a layer above the app, or null when there is nothing to hand off. */
export function captureBootGhost(): BootGhost | null {
  const html = document.documentElement;
  const card = document.getElementById("boot-shell-card");
  const ring = card?.querySelector<HTMLElement>("#boot-shell-ring");
  if (!card || !ring || html.dataset.oneOpening !== undefined) return null;
  if (card.closest("#boot-shell")?.querySelector("#boot-error")) return null;
  // The ring turns about its vertical axis, so its drawn width shrinks and grows. The box it sits
  // in does not, and the flight scales from that box.
  const drawn = ring.getBoundingClientRect();
  const from = new DOMRect(
    drawn.left + drawn.width / 2 - ring.offsetWidth / 2,
    drawn.top + drawn.height / 2 - ring.offsetHeight / 2,
    ring.offsetWidth,
    ring.offsetHeight,
  );
  if (from.width === 0) return null;
  const ringStyle = getComputedStyle(ring);
  const ringShown = {
    opacity: ringStyle.opacity,
    transform: ringStyle.transform,
    rotate: ringStyle.rotate,
  };
  const nameElement = card.querySelector<HTMLElement>("#boot-shell-name");
  const nameOpacity = nameElement ? getComputedStyle(nameElement).opacity : "0";
  const box = card.getBoundingClientRect();
  const layer = card.cloneNode(true) as HTMLElement;
  layer.classList.add("boot-ghost");
  layer.removeAttribute("aria-label");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;margin:0;z-index:2000;pointer-events:none;`;
  document.body.append(layer);
  const ghostRing = layer.querySelector<HTMLElement>("#boot-shell-ring");
  if (!ghostRing) {
    layer.remove();
    return null;
  }
  ghostRing.style.opacity = ringShown.opacity;
  ghostRing.style.transform = ringShown.transform;
  ghostRing.style.rotate = ringShown.rotate;
  const ghostName = layer.querySelector<HTMLElement>("#boot-shell-name");
  if (ghostName) ghostName.style.opacity = nameOpacity;
  return { layer, ring: ghostRing, name: ghostName, from, ringShown, nameOpacity };
}

/** The angle in a `rotate` value such as `0 1 0 120deg`. */
function angleOf(rotate: string): number {
  return Number(/(-?\d+(?:\.\d+)?)deg/.exec(rotate)?.[1] ?? 0);
}

/** The turn the boot ring is caught in, finished the short way round so it lands face on. */
function untwistedRotate(rotate: string): string {
  const degrees = Number(/(-?\d+(?:\.\d+)?)deg/.exec(rotate)?.[1] ?? 0) % 360;
  return `0 1 0 ${degrees > 180 ? 360 : degrees < -180 ? -360 : 0}deg`;
}

type Target = { readonly element: HTMLElement; readonly kind: "home" | "lockup" };

/** On screen and drawn: an off-canvas sidebar or a hidden header still has a rect, but nothing to land on. */
function isOnScreen(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= 0 &&
    rect.top >= 0 &&
    rect.right <= window.innerWidth &&
    rect.bottom <= window.innerHeight &&
    // Older Safari has no checkVisibility.
    (typeof element.checkVisibility === "function"
      ? element.checkVisibility()
      : element.getClientRects().length > 0)
  );
}

function findTarget(expectHome: boolean): Target | null {
  const home = document.querySelector<HTMLElement>(".one-chat-welcome .one-chat-welcome-orb");
  if (home && isOnScreen(home)) return { element: home, kind: "home" };
  if (expectHome) return null;
  // The header lockup is a desktop part: on a phone the brand is not drawn where it is measured.
  if (!window.matchMedia("(min-width: 768px)").matches) return null;
  const lockup = document.querySelector<HTMLElement>("[data-one-brand-glyph]");
  if (lockup && isOnScreen(lockup)) return { element: lockup, kind: "lockup" };
  return null;
}

export interface HandoffOptions {
  /** Longest wait for a thread's first screen of messages. Defaults to the time the boot took, at most four seconds. */
  readonly holdBoundMs?: number;
}

/** A thread route: the ring waits for its first screen of messages before it flies. */
function isThreadRoute(): boolean {
  const { pathname } = window.location;
  return /^\/[^/]+\/[^/]+\/?$/.test(pathname) && !pathname.startsWith("/settings");
}

function firstScreenReady(): boolean {
  // On the rows, the loading placeholder or the empty state, whichever the timeline shows.
  return document.querySelector("[data-first-screen-ready]") !== null;
}

/** Numbers the first turns so each rises 30ms after the one above (see one-pages.css). */
function stageTurns(): void {
  const rows = document.querySelectorAll<HTMLElement>(
    "[data-assistant-citation-viewport] [data-timeline-row-id]",
  );
  rows.forEach((row, index) =>
    row.style.setProperty("--one-arrive-index", String(Math.min(index, 8))),
  );
}

/**
 * Flies the ghost to the app's ring and clears everything it touched, whatever happens. On a thread
 * the ring first holds at the centre until the first screen of messages is ready, never longer than
 * the boot took, with the app live underneath. Then ring and wordmark fly to the sidebar lockup
 * together (or the ring to the home ring while the name leaves) as the app and its turns arrive.
 */
export function playBootHandoff(ghost: BootGhost, options: HandoffOptions = {}): void {
  const html = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const holdBound = options.holdBoundMs ?? Math.min(4000, Math.max(300, performance.now()));
  let finished = false;
  let target: Target | null = null;
  let wordmark: HTMLElement | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    ghost.layer.remove();
    for (const element of [target?.element, wordmark]) {
      element?.style.removeProperty("opacity");
      element?.style.removeProperty("transition");
    }
    document
      .querySelectorAll<HTMLElement>("[data-timeline-row-id]")
      .forEach((row) => row.style.removeProperty("--one-arrive-index"));
    delete html.dataset.oneHandoff;
  };
  const fade = (element: Element, duration: number) =>
    element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
      easing: "linear",
      fill: "forwards",
    });
  // A last resort: whatever happens, the layer is gone 20 seconds after the boot.
  window.setTimeout(finish, 20_000);

  // The handoff is decoration: anything that throws lets the app show at once.
  const failOpen = () => finish();
  let idleTurn: Animation | null = null;
  let currentRotate = ghost.ringShown.rotate;
  if (!reduced) {
    try {
      // The ring keeps turning while it waits, from the angle the boot left it at.
      const from = Number(/(-?\d+(?:\.\d+)?)deg/.exec(ghost.ringShown.rotate)?.[1] ?? 0);
      idleTurn = ghost.ring.animate(
        [{ rotate: `0 1 0 ${from}deg` }, { rotate: `0 1 0 ${from + 360}deg` }],
        { duration: 8000, iterations: Infinity, easing: "linear" },
      );
    } catch {
      idleTurn = null;
    }
  }

  const startUnsafe = (found: Target | null) => {
    if (finished) return;
    if (!found) {
      delete html.dataset.oneHandoff;
      void fade(ghost.layer, 200).finished.then(finish, finish);
      return;
    }
    target = found;
    // Where the turn has got to, so the flight carries on from it.
    currentRotate = getComputedStyle(ghost.ring).rotate;
    idleTurn?.cancel();
    ghost.ring.style.rotate = currentRotate;
    // The targets have their own opacity transitions; without this they would fade in after the swap.
    found.element.style.transition = "none";
    found.element.style.opacity = "0";
    stageTurns();
    html.dataset.oneHandoff = "travel";
    ghost.layer.querySelectorAll("#boot-shell-sweep").forEach((node) => {
      (node as HTMLElement).style.display = "none";
    });
    const nameRect = ghost.name?.getBoundingClientRect();
    wordmark =
      found.kind === "lockup" ? document.querySelector<HTMLElement>("[data-one-wordmark]") : null;
    if (wordmark && !isOnScreen(wordmark)) wordmark = null;
    const wordRect = wordmark?.getBoundingClientRect();
    if (ghost.name && nameRect && wordmark && wordRect && wordRect.width > 0) {
      // The wordmark travels with the ring as one lockup.
      wordmark.style.transition = "none";
      wordmark.style.opacity = "0";
      const nameScale = wordRect.height / Math.max(nameRect.height, 1);
      ghost.name.animate(
        [
          { opacity: ghost.nameOpacity, transform: "none" },
          {
            opacity: 1,
            transform: `translate(${wordRect.left + wordRect.width / 2 - (nameRect.left + nameRect.width / 2)}px, ${
              wordRect.top + wordRect.height / 2 - (nameRect.top + nameRect.height / 2)
            }px) scale(${nameScale})`,
          },
        ],
        { duration: TRAVEL_MS, easing: EASE, fill: "forwards" },
      );
    } else if (ghost.name) {
      // On home the name leaves as the ring does.
      ghost.name.animate(
        [
          { opacity: ghost.nameOpacity, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(8px)" },
        ],
        { duration: NAME_LEAVE_MS, easing: "linear", fill: "forwards" },
      );
    }
    // The halo comes up with the flight, so the ring lands in the light the app's ring is in.
    ghost.ring.classList.add("one-ring-halo");
    flyRing(found);
  };

  /**
   * One ring for the whole flight. The ghost follows the live target's box frame by frame, so a
   * layout that shifts under it (the headline arriving, a welcome remounting) cannot leave it
   * offset; if the target goes away it waits for the next one. It lands exactly on the box, and in
   * that one frame the ghost hides and the app's own ring shows: never two rings, never none.
   */
  const flyRing = (first: Target) => {
    let current = first;
    const begunAt = performance.now();
    const turnFrom = angleOf(currentRotate);
    const turnTo = angleOf(untwistedRotate(currentRotate));
    const openFrom = Number(ghost.ringShown.opacity);
    // Where the title moment had the ring (a settling tilt and scale), so the flight starts there.
    const matrix = /^matrix\(([^)]+)\)$/
      .exec(ghost.ringShown.transform)?.[1]
      ?.split(",")
      .map(Number);
    const scaleFrom = matrix ? Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0) : 1;
    const tiltFrom = matrix ? (Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1) * 180) / Math.PI : 0;
    let lostSince: number | null = null;
    const hold = (element: HTMLElement) => {
      // The ring has its own opacity transition; without this it would fade in after the swap.
      element.style.transition = "none";
      element.style.opacity = "0";
    };
    const place = (progress: number, to: DOMRect) => {
      const eased = 1 - (1 - progress) ** 3.4;
      const dx = to.left + to.width / 2 - (ghost.from.left + ghost.from.width / 2);
      const dy = to.top + to.height / 2 - (ghost.from.top + ghost.from.height / 2);
      const scale = scaleFrom + (to.width / ghost.from.width - scaleFrom) * eased;
      ghost.ring.style.transform = `translate(${dx * eased}px, ${dy * eased}px) rotate(${tiltFrom * (1 - eased)}deg) scale(${scale})`;
      ghost.ring.style.rotate = `0 1 0 ${turnFrom + (turnTo - turnFrom) * eased}deg`;
      ghost.ring.style.opacity = String(openFrom + (1 - openFrom) * eased);
    };
    const step = () => {
      if (finished) return;
      try {
        const now = performance.now();
        if (!current.element.isConnected || !isOnScreen(current.element)) {
          // The welcome was replaced or hidden while the ring flew: follow the new one, or wait for it.
          const next = findTarget(current.kind === "home");
          if (next) {
            current = next;
            target = next;
            hold(next.element);
            lostSince = null;
          } else {
            lostSince ??= now;
            if (now - lostSince > TARGET_WAIT_MS) {
              ghost.ring.style.opacity = "1";
              void fade(ghost.layer, 200).finished.then(finish, finish);
              return;
            }
            requestAnimationFrame(step);
            return;
          }
        }
        const progress = Math.min(1, (now - begunAt) / TRAVEL_MS);
        const to = current.element.getBoundingClientRect();
        place(progress, to);
        if (progress < 1) {
          requestAnimationFrame(step);
          return;
        }
        // Landed on the live ring's box: swap in this one frame.
        current.element.style.opacity = "1";
        wordmark?.style.removeProperty("opacity");
        ghost.layer.style.visibility = "hidden";
        if (current.kind === "home") html.dataset.oneHandoff = "arrive";
        window.setTimeout(finish, 320);
      } catch {
        failOpen();
      }
    };
    requestAnimationFrame(step);
  };

  const start = (found: Target | null) => {
    try {
      startUnsafe(found);
    } catch {
      failOpen();
    }
  };

  // The app stays hidden until the ring is ready to fly, then fades in under it.
  html.dataset.oneHandoff = "wait";
  // Wait for the app to replace the boot screen, then give it a moment to draw a ring to fly to.
  let begun: number | null = null;
  const lookUnsafe = () => {
    if (finished) return;
    if (document.getElementById("boot-shell")) {
      requestAnimationFrame(look);
      return;
    }
    begun ??= performance.now();
    const waited = performance.now() - begun;
    // Read live: "/" redirects to the last thread, and a ring that waited for a home that never
    // comes would sit over the shown app beside its own lockup.
    const expectHome = window.location.pathname === "/";
    const expectThread = isThreadRoute();
    if (reduced) {
      // A plain crossfade, after the first screen on a thread.
      if (expectThread && !firstScreenReady() && waited < holdBound) {
        requestAnimationFrame(look);
        return;
      }
      html.dataset.oneHandoff = "fade";
      void fade(ghost.layer, 200).finished.then(finish, finish);
      return;
    }
    const home = findTarget(true);
    if (home) return start(home);
    if (expectThread) {
      // Held at the centre with the app live but unseen, until the turns are on screen.
      html.dataset.oneHandoff = "hold";
      if (firstScreenReady() || waited >= holdBound) return start(findTarget(false));
      requestAnimationFrame(look);
      return;
    }
    const found = findTarget(expectHome && waited <= HOME_WAIT_MS);
    if (waited > SHOW_APP_MS && html.dataset.oneHandoff === "wait") {
      html.dataset.oneHandoff = "settle";
    }
    if (found || waited > (expectHome ? HOME_WAIT_MS : WAIT_MS)) start(found);
    else requestAnimationFrame(look);
  };
  const look = () => {
    try {
      lookUnsafe();
    } catch {
      failOpen();
    }
  };
  look();
}

/** The handoff is decoration: a page it cannot read must still boot, so nothing here may throw. */
export function prepareBootHandoff(): () => void {
  let ghost: BootGhost | null = null;
  try {
    ghost = captureBootGhost();
  } catch {
    return () => {};
  }
  if (!ghost) return () => {};
  const captured = ghost;
  return () => {
    try {
      playBootHandoff(captured);
    } catch {
      captured.layer.remove();
    }
  };
}
