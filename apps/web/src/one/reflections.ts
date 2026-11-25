/**
 * Moves the edge reflection of the hovered `[data-one-reflect]` surface to the
 * pointer. One passive listener for the whole app; it writes two custom
 * properties per frame on a single element, so nothing re-renders or lays out.
 */
export function installOneReflections(): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    !window.matchMedia("(hover: hover)").matches
  ) {
    return () => {};
  }
  let frame = 0;
  let target: HTMLElement | null = null;
  let x = 0;
  let y = 0;

  const apply = () => {
    frame = 0;
    if (!target?.isConnected) return;
    const bounds = target.getBoundingClientRect();
    target.style.setProperty("--one-mx", `${x - bounds.left}px`);
    target.style.setProperty("--one-my", `${y - bounds.top}px`);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
    const next = event.target.closest<HTMLElement>("[data-one-reflect]");
    if (!next) return;
    target = next;
    x = event.clientX;
    y = event.clientY;
    if (frame === 0) frame = requestAnimationFrame(apply);
  };

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  return () => {
    document.removeEventListener("pointermove", onPointerMove);
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}
