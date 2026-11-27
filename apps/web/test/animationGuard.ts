/**
 * What may animate: a property the compositor can move without repainting the element. Anything
 * else (a box-shadow, a color, a size) is painted again on every frame while it runs. The extra
 * names are keyframe bookkeeping, not properties.
 */
const COMPOSITOR_PROPERTIES: ReadonlySet<string> = new Set([
  "opacity",
  "transform",
  "rotate",
  "scale",
  "translate",
  "offset",
  "easing",
  "composite",
  "computedOffset",
]);

/** The properties an animation changes, from its keyframes and, for a CSS one, its @keyframes rule. */
function animatedProperties(animation: Animation): string[] {
  const declared = (name: string): string[] => {
    const found: string[] = [];
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSKeyframesRule && rule.name === name) {
          for (const frame of rule.cssRules) {
            const style = (frame as CSSKeyframeRule).style;
            for (let index = 0; index < style.length; index += 1) found.push(style.item(index));
          }
        }
      }
    }
    return found;
  };
  const effect = animation.effect instanceof KeyframeEffect ? animation.effect : null;
  return [
    ...(effect?.getKeyframes().flatMap((frame) => Object.keys(frame)) ?? []),
    ...(animation instanceof CSSAnimation ? declared(animation.animationName) : []),
    ...(animation instanceof CSSTransition ? [animation.transitionProperty] : []),
  ];
}

interface OffContractAnimation {
  readonly target: string;
  readonly animation: string;
  readonly properties: readonly string[];
}

const describeTarget = (effect: AnimationEffect | null): string => {
  const target = effect instanceof KeyframeEffect ? effect.target : null;
  if (!(target instanceof Element)) return "(no target)";
  const slot = target.getAttribute("data-slot");
  const pseudo =
    effect instanceof KeyframeEffect && effect.pseudoElement ? effect.pseudoElement : "";
  return `${target.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}${target.className && typeof target.className === "string" ? `.${target.className.split(" ")[0]}` : ""}${pseudo}`;
};

/**
 * The running animations and transitions that touch a property off the compositor list.
 * `allowed` names a property with the reason it may animate here, so each exception is written down.
 */
export function offContractAnimations(
  allowed: Readonly<Record<string, string>> = {},
): OffContractAnimation[] {
  const off: OffContractAnimation[] = [];
  for (const animation of document.getAnimations()) {
    const properties = [
      ...new Set(animatedProperties(animation).filter((name) => !COMPOSITOR_PROPERTIES.has(name))),
    ].filter((name) => !(name in allowed));
    if (properties.length === 0) continue;
    off.push({
      target: describeTarget(animation.effect),
      animation:
        animation instanceof CSSAnimation
          ? animation.animationName
          : animation instanceof CSSTransition
            ? `transition ${animation.transitionProperty}`
            : "script",
      properties,
    });
  }
  return off;
}
