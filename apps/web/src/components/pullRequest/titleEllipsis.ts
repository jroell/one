import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { observeResize } from "../../lib/observeResize";

export interface ClippedTitle {
  /** The words that fit, without trailing space. The ellipsis is drawn after it. */
  readonly head: string;
  /** What was cut, with its leading space, so assistive technology still reads the full title. */
  readonly rest: string;
}

/**
 * Where a title that does not fit in `maxWidth` ends: after the last whole word that leaves room
 * for the ellipsis. Null when the title fits, or when even its first word does not fit, so the
 * caller keeps the plain character cut.
 */
export function clipAtWord(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): ClippedTitle | null {
  if (measure(text) <= maxWidth) return null;
  const ends: number[] = [];
  for (const match of text.matchAll(/\S+/g)) ends.push(match.index + match[0].length);
  const fits = (end: number) => measure(`${text.slice(0, end)}\u2026`) <= maxWidth;
  if (ends.length === 0 || !fits(ends[0]!)) return null;
  let low = 0;
  let high = ends.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(ends[middle]!)) low = middle;
    else high = middle - 1;
  }
  const end = ends[low]!;
  return { head: text.slice(0, end), rest: text.slice(end) };
}

function sameClip(a: ClippedTitle | null, b: ClippedTitle | null): boolean {
  if (a === null || b === null) return a === b;
  return a.head === b.head && a.rest === b.rest;
}

let canvas: CanvasRenderingContext2D | null | undefined;

function measurerFor(element: HTMLElement): ((text: string) => number) | null {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return null;
  const style = getComputedStyle(element);
  const context = canvas;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  return (text) => context.measureText(text).width;
}

/**
 * Clips a one-line title at a word boundary. The title's room is the line's width minus its
 * siblings, read from the line itself, so the clipped text never feeds back into the size it is
 * measured against.
 */
export function useWordEllipsis(
  text: string,
  enabled: boolean,
): { ref: RefObject<HTMLSpanElement | null>; clipped: ClippedTitle | null } {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = useState<ClippedTitle | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the title against its line's width and observes the line and its siblings for size changes
  useLayoutEffect(() => {
    const element = ref.current;
    const line = element?.parentElement;
    if (!enabled || !element || !line) return;
    const update = () => {
      const measure = measurerFor(element);
      if (!measure) return;
      const siblings = Array.from(line.children).filter((child) => child !== element);
      const gap = Number.parseFloat(getComputedStyle(line).columnGap) || 0;
      const used = siblings.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
      const room = line.clientWidth - used - gap * siblings.length;
      const next = clipAtWord(text, room, measure);
      setClipped((held) => (sameClip(held, next) ? held : next));
    };
    update();
    const stopObserving = observeResize(
      [line, ...Array.from(line.children).filter((child) => child !== element)],
      update,
    );
    // A web font that arrives late changes every width at once.
    const fonts = document.fonts;
    if (fonts) void fonts.ready.then(update);
    return stopObserving;
  }, [text, enabled]);
  return { ref, clipped };
}
