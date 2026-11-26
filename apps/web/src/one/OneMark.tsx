import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { ONE_MARK_LIT_AXIS, ONE_MARK_LIT_STOPS, ONE_MARK_PATHS } from "./oneMarkPaths";
import { ORB_MARK_DENSITIES, orbMarkUrl, type OrbMarkSize } from "./oneOrbRest";
import { holdRestRing, type RestRingHold } from "./restRingPicture";

/** The mark drawn as vectors, from the `--one-ring-*` tokens: the stand-in when an image is missing or a chosen theme recolors the ring. */
function VectorMark() {
  const id = useId();
  const band = `${id}band`;
  const wall = `${id}wall`;
  const sheen = `${id}sheen`;
  const spec = `${id}spec`;
  const clip = `${id}clip`;
  return (
    <svg
      aria-hidden="true"
      data-one-mark-vector=""
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={band}
          x1={ONE_MARK_LIT_AXIS.x1}
          y1={ONE_MARK_LIT_AXIS.y1}
          x2={ONE_MARK_LIT_AXIS.x2}
          y2={ONE_MARK_LIT_AXIS.y2}
          gradientUnits="userSpaceOnUse"
        >
          {ONE_MARK_LIT_STOPS.map(([offset, tone]) => (
            <stop key={offset} offset={offset} style={{ stopColor: `var(--one-ring-${tone})` }} />
          ))}
        </linearGradient>
        <linearGradient id={wall} x1="5" y1="9" x2="19" y2="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--one-ring-deep)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--one-ring-lo)" }} />
          <stop offset="1" style={{ stopColor: "var(--one-ring-mid)" }} />
        </linearGradient>
        <linearGradient id={spec} x1="3.5" y1="10" x2="11" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
          <stop offset="0.35" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0.95" />
          <stop offset="1" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
          <stop offset="0.5" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0.9" />
          <stop offset="1" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <path clipRule="evenodd" d={ONE_MARK_PATHS.band} />
        </clipPath>
      </defs>
      <g transform="rotate(-24 12 12)">
        {/* Inner wall: the far side of the band, seen through the opening. */}
        <path fill={`url(#${wall})`} d={ONE_MARK_PATHS.wall} />
        {/* Outer band. */}
        <path
          fill={`url(#${band})`}
          fillRule="evenodd"
          clipRule="evenodd"
          d={ONE_MARK_PATHS.band}
        />
        {/* Soft shade where the band turns away from the light. */}
        <path
          d={ONE_MARK_PATHS.shade}
          stroke="var(--one-ring-deep)"
          strokeOpacity="0.38"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        {/* Specular lights. */}
        <path
          d={ONE_MARK_PATHS.specular}
          stroke={`url(#${spec})`}
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M8 17.1c1.3.4 2.6.6 4 .6 1.1 0 2.1-.1 3-.4"
          stroke="var(--one-ring-spec)"
          strokeWidth="0.45"
          strokeLinecap="round"
          strokeOpacity="0.5"
        />
        {/* The glint: the one catch-light that is part of the mark, fixed at one o'clock. */}
        <path d={ONE_MARK_PATHS.glint} fill="var(--one-ring-spec)" fillOpacity="0.92" />
        {/* A band of light that travels across the ring on hover. */}
        <g clipPath={`url(#${clip})`}>
          <rect
            className="one-mark-sheen"
            x="-9"
            y="2"
            width="7"
            height="20"
            fill={`url(#${sheen})`}
            transform="skewX(-18)"
          />
        </g>
      </g>
    </svg>
  );
}

/** True while a chosen theme (not the standard gold) is on: the picture is recolored for it. */
function chosenTheme(): boolean {
  return (document.documentElement.dataset.themeId ?? "") !== "";
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-id"],
  });
  return () => observer.disconnect();
}

/**
 * The ring drawn in the theme's ring colors (`--one-ring-lo/mid/hi`), once it has decoded, or
 * null while it is pending, if WebGL cannot draw it, or while the standard theme is on. It follows
 * theme, mode and screen-density changes and lets its picture go when it changes or unmounts.
 */
function useThemedPicture(root: RefObject<HTMLElement | null>, size: OrbMarkSize): string | null {
  const [url, setUrl] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the picture in step with the theme attributes on <html> and the screen density, which change outside React
  useEffect(() => {
    const html = document.documentElement;
    let current = 0;
    let held: RestRingHold | null = null;
    let density: MediaQueryList | null = null;
    const update = () => {
      held?.release();
      held = null;
      const element = root.current;
      if (!element || !chosenTheme()) {
        setUrl(null);
        return;
      }
      const style = getComputedStyle(element);
      const ring = (tone: string) => style.getPropertyValue(`--one-ring-${tone}`);
      const request = (current += 1);
      const next = holdRestRing({
        lo: ring("lo"),
        mid: ring("mid"),
        hi: ring("hi"),
        dark: html.classList.contains("dark"),
        size,
        density: Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1))),
      });
      held = next;
      // Until it has decoded, the vector drawing in the same colors shows.
      void next.picture
        .then(async (picture) => {
          const decoded = new Image();
          decoded.src = picture;
          await decoded.decode();
          if (request === current) setUrl(picture);
        })
        .catch(() => {
          if (request === current) setUrl(null);
        });
      density?.removeEventListener("change", update);
      density = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      density.addEventListener("change", update);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme-id"],
    });
    return () => {
      observer.disconnect();
      density?.removeEventListener("change", update);
      current += 1;
      held?.release();
    };
  }, [root, size]);
  return url;
}

/**
 * The One mark: the live ring's rest pose as a picture (public/mark, drawn by
 * scripts/render-mark.mjs). A chosen theme gets the same ring drawn in its colors
 * (restRingPicture.ts); the vector drawing only stands in for a missing image. `size` is the CSS width and picks the file.
 */
export function OneMark({
  className,
  interactive = false,
  size = 64,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Plays the reflection sweep on hover and the squash on press of the nearest `.one-mark-host`. */
  readonly interactive?: boolean;
  readonly size?: OrbMarkSize;
}) {
  const [imageMissing, setImageMissing] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const chosen = useSyncExternalStore(subscribeToTheme, chosenTheme, () => false);
  const themed = useThemedPicture(root, size);
  // A chosen theme shows the vector in its colors until its picture has decoded, and keeps it if
  // the picture cannot be drawn; a standard picture that fails to load does the same.
  const showVector = imageMissing || (chosen && themed === null);
  const image = (theme: "dark" | "light") => (
    <img
      alt=""
      aria-hidden="true"
      data-mark-theme={theme}
      width={size}
      height={size}
      src={orbMarkUrl(theme, size, 1)}
      srcSet={ORB_MARK_DENSITIES.map(
        (density) => `${orbMarkUrl(theme, size, density)} ${density}x`,
      ).join(", ")}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setImageMissing(true)}
    />
  );
  return (
    <span
      ref={root}
      aria-hidden="true"
      {...props}
      data-one-mark={interactive ? "interactive" : "static"}
      data-vector={showVector ? "" : undefined}
      className={cn("one-mark", className)}
    >
      {chosen ? (
        themed === null ? null : (
          <img
            alt=""
            aria-hidden="true"
            data-mark-tinted=""
            width={size}
            height={size}
            src={themed}
            draggable={false}
            onError={() => setImageMissing(true)}
          />
        )
      ) : (
        <>
          {image("dark")}
          {image("light")}
        </>
      )}
      {showVector ? <VectorMark /> : null}
    </span>
  );
}
