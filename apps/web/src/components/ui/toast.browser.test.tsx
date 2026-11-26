import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { fakeTimers, render } from "../../../test/render";
import { AnchoredToastProvider, ToastProvider, setToastsSuppressed, toastManager } from "./toast";

/** Empties the module-level toast queue when the test ends, so the next test starts clean. */
function emptyToastQueue(): Disposable {
  return { [Symbol.dispose]: () => toastManager.close() };
}

describe("toastManager", () => {
  it("shows a toast added before any provider mounted", async () => {
    toastManager.add({ type: "info", title: "Raised before the first render" });

    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();

    await expect.element(page.getByText("Raised before the first render")).toBeVisible();
  });

  it("exposes one Notifications landmark when both toast providers mount", async () => {
    await using _screen = await render(
      <ToastProvider>
        <AnchoredToastProvider>{null}</AnchoredToastProvider>
      </ToastProvider>,
    );

    const notifications = page.getByRole("region", { name: "Notifications" });
    await expect.element(notifications.first()).toBeInTheDocument();
    expect(
      notifications.elements(),
      "only the corner toast viewport should be a Notifications landmark",
    ).toHaveLength(1);
    await expect.element(notifications).toHaveAttribute("data-slot", "toast-viewport");

    const anchoredViewport = document.querySelector("[data-slot=toast-viewport-anchored]");
    expect(anchoredViewport).toHaveAttribute("aria-live", "polite");
  });
});

/** Lets React and Base UI's queued work settle without advancing the faked clock. */
async function settle() {
  for (let turn = 0; turn < 6; turn++) await vi.advanceTimersByTimeAsync(0);
}

const shownTitles = () =>
  [...document.querySelectorAll("[data-slot=toast-viewport] [data-slot=toast-title]")].map(
    (element) => element.textContent,
  );

describe("the toast queue in the running provider", () => {
  it("keeps a normal-priority error with an action behind a persistent toast, with its time not started, and shows it announced and actionable when it surfaces", async () => {
    const retry = vi.fn();
    const onClose = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    using _clock = fakeTimers();
    const persistent = toastManager.add({ type: "error", title: "Persistent failure", timeout: 0 });
    toastManager.add({
      type: "error",
      title: "Needs a retry",
      timeout: 5000,
      onClose,
      data: { onRetry: retry },
    });
    await settle();
    expect(shownTitles()).toEqual(["Persistent failure"]);

    // Far longer than any timeout: a waiting toast has no timer to run out.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("[data-slot=toast-count]")?.textContent).toBe("+1");

    toastManager.close(persistent);
    await settle();
    expect(shownTitles()).toContain("Needs a retry");
    const region = document.querySelector('[data-slot="toast-viewport"]')!;
    expect(region.getAttribute("aria-live"), "announced through the polite live region").toBe(
      "polite",
    );
    expect(region.textContent).toContain("Needs a retry");

    // An error with an action stays until it is dismissed or acted on.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onClose).not.toHaveBeenCalled();
    // The clock was moved far ahead, so the action is pressed with a plain DOM click.
    vi.useRealTimers();
    document.querySelector<HTMLElement>('[data-slot="toast-retry"]')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("starts an ordinary toast's time when it is shown, not when it was added", async () => {
    const onClose = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    using _clock = fakeTimers();
    const first = toastManager.add({ type: "info", title: "Shown first", timeout: 0 });
    toastManager.add({ type: "info", title: "Shown second", timeout: 3000, onClose });
    await settle();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onClose).not.toHaveBeenCalled();
    toastManager.close(first);
    await settle();
    expect(shownTitles()).toContain("Shown second");

    await vi.advanceTimersByTimeAsync(2999);
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("runs onClose and onRemove for every toast, waiting or shown, when all are closed", async () => {
    const calls: string[] = [];
    const callbacks = (id: string) => ({
      onClose: () => calls.push(`${id}:close`),
      onRemove: () => calls.push(`${id}:remove`),
    });
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    toastManager.add({ type: "info", title: "Shown", timeout: 0, ...callbacks("shown") });
    toastManager.add({ type: "info", title: "Waits one", timeout: 0, ...callbacks("one") });
    toastManager.add({ type: "info", title: "Waits two", timeout: 0, ...callbacks("two") });
    await expect.element(page.getByText("Shown")).toBeVisible();

    toastManager.close();

    await vi.waitFor(() =>
      expect(calls.toSorted()).toEqual([
        "one:close",
        "one:remove",
        "shown:close",
        "shown:remove",
        "two:close",
        "two:remove",
      ]),
    );
  });

  it("keeps keyboard focus on a toast's action when newer toasts arrive, then shows them after it", async () => {
    const retry = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    const shown = toastManager.add({
      type: "error",
      title: "Focused failure",
      data: { onRetry: retry },
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="toast-retry"]')).not.toBeNull(),
    );
    const action = document.querySelector<HTMLElement>("[data-slot=toast-retry]")!;
    action.focus();
    expect(document.activeElement).toBe(action);

    toastManager.add({ type: "info", title: "Newer notice" });
    toastManager.add({ type: "error", title: "Newer error", data: { onRetry: () => {} } });
    await vi.waitFor(() =>
      expect(document.querySelector("[data-slot=toast-count]")?.textContent).toBe("+2"),
    );

    expect(document.activeElement, "focus stays on the action").toBe(action);
    expect(action.isConnected).toBe(true);
    expect(shownTitles()).toEqual(["Focused failure"]);

    toastManager.close(shown);
    await expect.element(page.getByText("Newer error").first()).toBeVisible();
  });

  it("opens the list of waiting toasts from +N and shows the one picked", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    toastManager.add({ type: "info", title: "On screen", timeout: 0 });
    toastManager.add({ type: "success", title: "Waiting one", timeout: 0 });
    toastManager.add({ type: "info", title: "Waiting two", timeout: 0 });
    await expect.element(page.getByText("On screen")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "2 more notifications" }));
    await expect.element(page.getByText("Waiting two")).toBeVisible();
    await userEvent.click(page.getByText("Waiting two"));

    await vi.waitFor(() => expect(shownTitles()).toContain("Waiting two"));
  });
});

describe("toasts while the voice stage has them suppressed", () => {
  const suppressed = (): Disposable => {
    setToastsSuppressed(true);
    return { [Symbol.dispose]: () => setToastsSuppressed(false) };
  };
  const viewportText = () =>
    document.querySelector('[data-slot="toast-viewport"]')?.textContent ?? "";

  it("holds a toast raised during suppression with no timer and no announcement, then shows it with its time starting then", async () => {
    const onClose = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    using _clock = fakeTimers();
    {
      using _suppressed = suppressed();
      toastManager.add({ type: "info", title: "Raised under suppression", timeout: 3000, onClose });
      await settle();
      expect(viewportText()).not.toContain("Raised under suppression");
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(onClose, "a held toast has no timer to run out").not.toHaveBeenCalled();
    }
    await settle();
    expect(shownTitles()).toEqual(["Raised under suppression"]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends the toast on screen back to the queue without running its callbacks, and shows it again afterwards", async () => {
    const onClose = vi.fn();
    const onRemove = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    toastManager.add({ type: "info", title: "On screen", timeout: 0, onClose, onRemove });
    await expect.element(page.getByText("On screen")).toBeVisible();

    {
      using _suppressed = suppressed();
      await vi.waitFor(() => expect(viewportText()).not.toContain("On screen"));
      expect(onClose).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();
    }

    await expect.element(page.getByText("On screen")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps an error with an action through suppression, with its Retry button working afterwards", async () => {
    const retry = vi.fn();
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    using _queue = emptyToastQueue();
    using _clock = fakeTimers();
    {
      using _suppressed = suppressed();
      toastManager.add({ type: "error", title: "Could not save", data: { onRetry: retry } });
      await settle();
      expect(viewportText()).not.toContain("Could not save");
    }
    await settle();
    expect(shownTitles()).toEqual(["Could not save"]);
    vi.useRealTimers();
    document.querySelector<HTMLElement>('[data-slot="toast-retry"]')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("releases the thread's toast padding while suppressed and takes it again afterwards", async () => {
    await using screen = await render(
      <ToastProvider>
        <div
          className="messages-timeline-scroll"
          data-testid="timeline"
          style={{ height: 200, overflow: "auto" }}
        >
          <div style={{ height: 800 }}>messages</div>
        </div>
      </ToastProvider>,
    );
    using _queue = emptyToastQueue();
    const timeline = screen.getByTestId("timeline").element() as HTMLElement;
    toastManager.add({ type: "info", title: "Lane toast", timeout: 0 });
    await expect.element(page.getByText("Lane toast")).toBeVisible();
    expect(timeline.style.paddingBottom).not.toBe("");

    {
      using _suppressed = suppressed();
      await vi.waitFor(() => expect(timeline.style.paddingBottom).toBe(""));
    }
    await vi.waitFor(() => expect(timeline.style.paddingBottom).not.toBe(""));
  });
});
