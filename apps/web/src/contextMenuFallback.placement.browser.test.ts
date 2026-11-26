import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { dismissContextMenu, showContextMenuFallback } from "./contextMenuFallback";

const items = [
  { id: "rename", label: "Rename this thread" },
  { id: "archive", label: "Archive this thread" },
];

/** Opens the menu and returns its element; placement runs in the frame after it mounts. */
async function openAt(position: { x: number; y: number; flipTo?: number }) {
  void showContextMenuFallback(items, position);
  const menu = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>('body > div[style*="z-index: 10000"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  return { menu, [Symbol.dispose]: () => dismissContextMenu() };
}

it("opens to the right of the row when there is room", async () => {
  await page.viewport(900, 600);
  using opened = await openAt({ x: 306, y: 100, flipTo: 250 });
  await vi.waitFor(() => expect(opened.menu.style.left).toBe("306px"));
});

it("opens to the left of the row, not over it, when the right side is too narrow", async () => {
  await page.viewport(900, 600);
  // A row near the right edge of the window: its left edge is at 640 and its right edge at 894.
  using opened = await openAt({ x: 900, y: 100, flipTo: 634 });
  await vi.waitFor(() => {
    const box = opened.menu.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(634);
    expect(box.left).toBeGreaterThanOrEqual(4);
  });
});

it("keeps to the window when neither side has room for the menu", async () => {
  await page.viewport(900, 600);
  using opened = await openAt({ x: 900, y: 100, flipTo: 40 });
  await vi.waitFor(() => {
    const box = opened.menu.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(896);
    expect(box.left).toBeGreaterThanOrEqual(4);
  });
});
