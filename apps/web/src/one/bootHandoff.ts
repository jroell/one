/**
 * Hands the boot ring to the app as one motion: a copy of the boot card flies to the app's ring
 * (the home ring, else the sidebar lockup) while the name goes. Transform and opacity only, no
 * input taken, and under reduced motion a plain crossfade.
 */ const EASE = "cubic-bezier(0.2, 0.9, 0.1, 1)";
const TRAVEL_MS = 560;
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
}

/** Copies the boot card to a layer above the app, or null when there is nothing to hand off. */
export function captureBootGhost(): BootGhost | null {
  const html = document.documentElement;
  const card = document.getElementById("boot-shell-card");
  const ring = card?.querySelector<HTMLElement>("#boot-shell-ring");
  if (!card || !ring || html.dataset.oneOpening !== undefined) return null;
  if (card.closest("#boot-shell")?.querySelector("#boot-error")) return null;
  const from = ring.getBoundingClientRect();
  if (from.width === 0) return null;
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
  return {
    layer,
    ring: ghostRing,
    name: layer.querySelector<HTMLElement>("#boot-shell-name"),
    from,
  };
}

type Target = { readonly element: HTMLElement; readonly kind: "home" | "lockup" };

function findTarget(expectHome: boolean): Target | null {
  const home = document.querySelector<HTMLElement>("[data-one-code-welcome] .one-chat-welcome-orb");
  if (home && home.getBoundingClientRect().width > 0) return { element: home, kind: "home" };
  if (expectHome) return null;
  const lockup = document.querySelector<HTMLElement>("[data-one-brand-glyph]");
  if (lockup && lockup.getBoundingClientRect().width > 0)
    return { element: lockup, kind: "lockup" };
  return null;
}

/** Flies the ghost to the app's ring and clears everything it touched, whatever happens. */
export function playBootHandoff(ghost: BootGhost): void {
  const html = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let finished = false;
  let target: Target | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    ghost.layer.remove();
    if (target) {
      target.element.style.removeProperty("opacity");
      target.element.style.removeProperty("transition");
    }
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

  const start = (found: Target | null) => {
    if (finished) return;
    if (reduced || !found) {
      delete html.dataset.oneHandoff;
      void fade(ghost.layer, 200).finished.then(finish, finish);
      return;
    }
    target = found;
    const to = found.element.getBoundingClientRect();
    const scale = to.width / ghost.from.width;
    const dx = to.left + to.width / 2 - (ghost.from.left + ghost.from.width / 2);
    const dy = to.top + to.height / 2 - (ghost.from.top + ghost.from.height / 2);
    // The ring has its own opacity transition; without this it would fade in after the swap.
    found.element.style.transition = "none";
    found.element.style.opacity = "0";
    html.dataset.oneHandoff = "travel";
    ghost.layer.querySelectorAll("#boot-shell-arc, #boot-shell-sweep").forEach((node) => {
      (node as HTMLElement).style.display = "none";
    });
    if (ghost.name) {
      ghost.name.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(8px)" },
        ],
        { duration: 200, easing: "linear", fill: "forwards" },
      );
    }
    const travel = ghost.ring.animate(
      [{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
      { duration: TRAVEL_MS, easing: EASE, fill: "forwards" },
    );
    void travel.finished.then(() => {
      if (finished) return;
      // The app's ring shows at once under the ghost, which then fades off it: no dip between.
      found.element.style.removeProperty("opacity");
      if (found.kind === "home") html.dataset.oneHandoff = "arrive";
      void fade(ghost.layer, 120).finished.then(() => {
        window.setTimeout(finish, 320);
      }, finish);
    }, finish);
  };

  // The app fades in under the flying ring instead of cutting in.
  html.dataset.oneHandoff = "wait";
  // Wait for the app to replace the boot screen, then give it a moment to draw a ring to fly to.
  const expectHome = window.location.pathname === "/";
  let begun: number | null = null;
  const look = () => {
    if (finished) return;
    if (document.getElementById("boot-shell")) {
      requestAnimationFrame(look);
      return;
    }
    if (reduced) {
      // A plain crossfade: the app fades in as the boot screen fades out.
      html.dataset.oneHandoff = "fade";
      void fade(ghost.layer, 200).finished.then(finish, finish);
      return;
    }
    begun ??= performance.now();
    const waited = performance.now() - begun;
    const found = findTarget(expectHome && waited <= HOME_WAIT_MS);
    if (waited > SHOW_APP_MS && html.dataset.oneHandoff === "wait")
      html.dataset.oneHandoff = "settle";
    if (found || waited > (expectHome ? HOME_WAIT_MS : WAIT_MS)) start(found);
    else requestAnimationFrame(look);
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
