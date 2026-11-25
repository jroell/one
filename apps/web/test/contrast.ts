type Rgba = [number, number, number, number];

function parse(css: string): Rgba {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

function over(top: Rgba, below: Rgba): Rgba {
  const alpha = top[3] + below[3] * (1 - top[3]);
  const mix = (index: 0 | 1 | 2) =>
    alpha === 0 ? 0 : (top[index] * top[3] + below[index] * below[3] * (1 - top[3])) / alpha;
  return [mix(0), mix(1), mix(2), alpha];
}

function luminance([r, g, b]: Rgba) {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** What is painted behind an element: its ancestors' backgrounds laid over one another. */
function backdrop(element: Element): Rgba {
  let color: Rgba = [0, 0, 0, 0];
  for (let node: Element | null = element; node; node = node.parentElement) {
    color = over(color, parse(getComputedStyle(node).backgroundColor));
  }
  return over(color, parse(getComputedStyle(document.body).backgroundColor));
}

/**
 * The WCAG contrast ratio of an element's text against what is painted behind it, with the text's
 * own alpha and every translucent ancestor background composited. `pseudo` reads a pseudo-element
 * such as "::placeholder".
 */
export function textContrast(element: Element, pseudo?: string): number {
  const background = backdrop(element);
  const ink = over(parse(getComputedStyle(element, pseudo).color), background);
  const [hi, lo] = [luminance(ink), luminance(background)].toSorted((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}
