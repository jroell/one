import { splitForMiddleTruncate } from "../ui/middle-truncate";

/**
 * Splits each file name the viewer draws in a header into a head that clips and a tail that stays,
 * so a long path keeps its folder start and its file name end (CSS in `DIFF_VIEW_UNSAFE_CSS`).
 * The viewer's own title element stays the only one: its text is still the whole path, which the
 * header's click and context-menu lookups, text queries and screen readers read.
 */
export function middleTruncateDiffHeaderTitles(root: ParentNode) {
  for (const bdi of root.querySelectorAll<HTMLElement>("[data-diffs-header] [data-title] > bdi")) {
    const path = bdi.textContent ?? "";
    // Already split for this path, or too short to split.
    if (bdi.dataset.pathSplit === path || bdi.querySelector("[data-path-head]")) continue;
    const split = splitForMiddleTruncate(path);
    if (split === null) continue;
    bdi.dataset.pathSplit = path;
    const head = bdi.ownerDocument.createElement("span");
    head.dataset.pathHead = "";
    head.textContent = split.head;
    const tail = bdi.ownerDocument.createElement("span");
    tail.dataset.pathTail = "";
    tail.textContent = split.tail;
    bdi.replaceChildren(head, tail);
    bdi.parentElement?.setAttribute("title", path);
  }
}
