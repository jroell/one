/** The serif stack the app sets Chat mode in, for the diagram renderer to measure labels with. */
export function readSerifStack(element: Element): string | undefined {
  return getComputedStyle(element).getPropertyValue("--one-serif").trim() || undefined;
}

const DRAW_SETTLE_MS = 1600;

/**
 * Prepares a mounted diagram's SVG for its first drawing: nodes fade in, then each edge is drawn
 * on, a beat after the one before. Only the first render draws; a resize that lays the diagram
 * out again leaves it still. The drawing's own styles live in one-chat.css.
 */
export function drawDiagramOn(container: HTMLElement) {
  let drawn = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const host = () => container.closest<HTMLElement>(".chat-markdown-mermaid");
  return {
    rendered(width: number) {
      container.style.setProperty("--pele-w", String(Math.round(width)));
      if (drawn) return;
      drawn = true;
      const edges = [...container.querySelectorAll<SVGGElement>(".pele-edge")];
      const labels = container.querySelectorAll<SVGGElement>(".pele-edge-label");
      for (const [index, edge] of edges.entries()) {
        edge.style.setProperty("--edge-i", String(index));
        for (const path of edge.querySelectorAll("path:not(.pele-marker)")) {
          path.setAttribute("pathLength", "1");
        }
        const id = edge.dataset.id;
        for (const label of labels) {
          if (label.dataset.id === id) label.style.setProperty("--edge-i", String(index));
        }
      }
      const root = host();
      if (root === null) return;
      root.dataset.draw = "";
      timer = setTimeout(() => delete root.dataset.draw, DRAW_SETTLE_MS + edges.length * 80);
    },
    destroy() {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
