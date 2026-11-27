/**
 * A row that opens or closes changes height at once and the list moves the rows below it later, so
 * its reveal is a wipe of two opposite transforms and the rows below slide by transform in step.
 */

const LOOK_FRAMES = 8;

function prefersMotion(): boolean {
  return (
    document.documentElement.dataset.oneMode !== "chat" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The list's absolutely positioned item that holds the element. */
function listItemOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.style.position === "absolute" && node.style.top !== "") return node;
  }
  return null;
}

function itemsBelow(item: HTMLElement): HTMLElement[] {
  const top = Number.parseFloat(item.style.top);
  return Array.from(item.parentElement?.children ?? []).filter(
    (sibling): sibling is HTMLElement =>
      sibling instanceof HTMLElement &&
      sibling !== item &&
      Number.parseFloat(sibling.style.top) > top,
  );
}

function timing(exit: boolean) {
  const style = getComputedStyle(document.documentElement);
  const token = style.getPropertyValue("--mo-quick").trim();
  const quick = token.endsWith("ms") ? Number.parseFloat(token) : Number.parseFloat(token) * 1000;
  const easing = style.getPropertyValue(exit ? "--ease-exit" : "--ease-enter").trim();
  return {
    duration: (Number.isFinite(quick) ? quick : 180) * (exit ? 0.7 : 1),
    easing: easing === "" ? (exit ? "ease-in" : "ease-out") : easing,
  };
}

/**
 * The wipe of `reveal`: its wrapper and its content move by equal and opposite transforms, which
 * leaves the top `shown` pixels of the content in view. Returns the animations.
 */
function wipe(
  reveal: HTMLElement,
  from: "shut" | "open",
  timingOptions: { duration: number; easing: string },
  fill: FillMode,
): Animation[] {
  const inner = reveal.firstElementChild;
  if (!(inner instanceof HTMLElement)) return [];
  const height = reveal.getBoundingClientRect().height;
  const shut = ["translateY(0)", `translateY(${-height}px)`];
  const content = ["translateY(0)", `translateY(${height}px)`];
  const [a, b] = from === "shut" ? [shut.toReversed(), content.toReversed()] : [shut, content];
  const options = { ...timingOptions, fill };
  reveal.style.overflow = "hidden";
  const animations = [
    reveal.animate([{ transform: a[0] }, { transform: a[1] }], options),
    inner.animate([{ transform: b[0] }, { transform: b[1] }], options),
  ];
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    if (fill !== "forwards") reveal.style.overflow = "";
  });
  return animations;
}

const tops = (items: ReadonlyArray<HTMLElement>) =>
  items.map((item) => Number.parseFloat(item.style.top));

/**
 * Calls `moved` as soon as one of the rows' positions changes: a style mutation is seen before the
 * frame is painted, where a frame callback would see it one frame too late. Returns the call that
 * stops watching.
 */
function watchTops(
  items: ReadonlyArray<HTMLElement>,
  before: ReadonlyArray<number>,
  moved: () => void,
): () => void {
  const observer = new MutationObserver(() => {
    if (tops(items).some((top, index) => top !== before[index])) moved();
  });
  for (const item of items)
    observer.observe(item, { attributes: true, attributeFilter: ["style"] });
  return () => observer.disconnect();
}

/**
 * Opens `reveal`: it stays clipped shut until the list has moved the rows below, then the clip
 * and the rows' slide start together (and a row that is new fades in with them). Returns the
 * call that stops it.
 */
export function openRowsBelow(
  reveal: HTMLElement,
  options: { readonly fade?: boolean } = {},
): () => void {
  if (!prefersMotion()) return () => {};
  const item = listItemOf(reveal);
  if (item === null) return () => {};
  const below = itemsBelow(item);
  const before = tops(below);
  const animations: Animation[] = [];
  let frame = 0;
  let raf = 0;
  reveal.dataset.oneArmed = "";
  const start = (moved: ReadonlyArray<number> | null) => {
    delete reveal.dataset.oneArmed;
    const { duration, easing } = timing(false);
    animations.push(
      ...(options.fade === true
        ? [reveal.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing })]
        : wipe(reveal, "shut", { duration, easing }, "none")),
    );
    moved?.forEach((by, index) =>
      animations.push(
        below[index]!.animate(
          [{ transform: `translateY(${-by}px)` }, { transform: "translateY(0)" }],
          { duration, easing },
        ),
      ),
    );
  };
  let begun = false;
  const begin = (moved: ReadonlyArray<number> | null) => {
    if (begun) return;
    begun = true;
    unwatch();
    start(moved);
  };
  const unwatch = watchTops(below, before, () =>
    begin(tops(below).map((top, index) => top - before[index]!)),
  );
  const look = () => {
    frame += 1;
    if (below.length === 0 || frame >= LOOK_FRAMES) {
      begin(null);
      return;
    }
    raf = requestAnimationFrame(look);
  };
  raf = requestAnimationFrame(look);
  return () => {
    cancelAnimationFrame(raf);
    unwatch();
    delete reveal.dataset.oneArmed;
    for (const animation of animations) animation.cancel();
  };
}

/** A close in progress. `reopen` turns it around and returns false when it already finished. */
export interface RowsClosing {
  readonly reopen: () => boolean;
}

/**
 * Closes `reveal` while its content is still mounted: the clip wipes it away and the rows below
 * slide up by its height. When the content leaves and the list moves the rows, the slide is
 * released in that same frame. If the row opens again first, `reopen` plays the wipe and the slide
 * back from where they are, as nothing below has moved.
 */
export function closeRowsBelow(reveal: HTMLElement): RowsClosing | null {
  if (!prefersMotion()) return null;
  const item = listItemOf(reveal);
  if (item === null) return null;
  const below = itemsBelow(item);
  const before = tops(below);
  const by = reveal.getBoundingClientRect().height;
  const { duration, easing } = timing(true);
  const clips = wipe(reveal, "open", { duration, easing }, "forwards");
  const clip = { finished: Promise.all(clips.map((animation) => animation.finished)) };
  const slides = below.map((row) =>
    row.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-by}px)` }], {
      duration,
      easing,
      fill: "forwards",
    }),
  );
  let unwatch = () => {};
  let over = false;
  const release = () => {
    over = true;
    unwatch();
    for (const slide of slides) slide.cancel();
    for (const animation of clips) animation.cancel();
    reveal.style.overflow = "";
  };
  void clip.finished.then(() => {
    if (over) return;
    // The content leaves and the list moves the rows: release the slide in that frame.
    unwatch = watchTops(below, before, release);
    let frame = 0;
    const look = () => {
      if (over) return;
      frame += 1;
      if (frame >= LOOK_FRAMES) release();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, release);
  return {
    reopen: () => {
      if (over) return false;
      over = true;
      unwatch();
      const all = [...clips, ...slides];
      for (const animation of all) animation.reverse();
      void Promise.allSettled(all.map((animation) => animation.finished)).then(() => {
        for (const animation of all) animation.cancel();
        reveal.style.overflow = "";
      });
      return true;
    },
  };
}
