import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { dismissContextMenu, showContextMenuFallback } from "./contextMenuFallback";

const items = [
  { id: "rename", label: "Rename this thread" },
  { id: "archive", label: "Archive this thread" },
];

/** Opens the menu and returns its element; placement runs in the frame after it mounts. */
async function openAt(position: Parameters<typeof showContextMenuFallback>[1]) {
  void showContextMenuFallback(items, position);
  const menu = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>('body > div[style*="z-index: 10000"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  return { menu, [Symbol.dispose]: () => dismissContextMenu() };
}

it("opens at the pointer, just below the row it acts on", async () => {
  await page.viewport(900, 600);
  using opened = await openAt({ x: 120, y: 152, avoid: { top: 120, bottom: 150 } });
  await vi.waitFor(() => {
    const box = opened.menu.getBoundingClientRect();
    expect(Math.round(box.left)).toBe(120);
    expect(box.top).toBeGreaterThanOrEqual(150);
  });
});

it("opens above the row, not over it, when there is more room above", async () => {
  await page.viewport(900, 600);
  // A row near the bottom of the window: the menu cannot fit below it.
  using opened = await openAt({ x: 200, y: 572, avoid: { top: 540, bottom: 570 } });
  await vi.waitFor(() => {
    const box = opened.menu.getBoundingClientRect();
    expect(box.bottom).toBeLessThanOrEqual(540);
    expect(box.left).toBeGreaterThanOrEqual(4);
  });
});

it("scrolls inside the larger side when it fits on neither, instead of covering the row", async () => {
  await page.viewport(900, 260);
  using opened = await openAt({ x: 200, y: 122, avoid: { top: 90, bottom: 120 } });
  await vi.waitFor(() => {
    const box = opened.menu.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(120);
    expect(box.bottom).toBeLessThanOrEqual(260);
  });
});

it("stays inside the window at the right edge", async () => {
  await page.viewport(900, 600);
  using opened = await openAt({ x: 899, y: 152, avoid: { top: 120, bottom: 150 } });
  await vi.waitFor(() => {
    const box = opened.menu.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(896);
    expect(box.top).toBeGreaterThanOrEqual(150);
  });
});
