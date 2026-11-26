import { hasVisibleToastAction } from "./toast.logic";

/** The part of a toast the queue reads; everything else passes through to Base UI untouched. */
export interface QueuedToastOptions {
  readonly id: string;
  readonly type?: string | undefined;
  readonly timeout?: number | undefined;
  readonly priority?: "low" | "high" | undefined;
  readonly actionProps?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly data?: unknown;
  readonly onClose?: (() => void) | undefined;
  readonly onRemove?: (() => void) | undefined;
  readonly [key: string]: unknown;
}

export type ToastQueueEvent =
  | { readonly action: "add"; readonly options: QueuedToastOptions }
  | { readonly action: "close"; readonly options: { readonly id?: string | undefined } }
  | {
      readonly action: "update";
      readonly options: { readonly id: string; readonly updates: Record<string, unknown> };
    }
  | { readonly action: "promise"; readonly options: unknown };

export interface WaitingToast {
  readonly id: string;
  readonly type: string | undefined;
  readonly title: unknown;
  /** An error, or a toast that carries an action: it is shown before an ordinary one. */
  readonly outranks: boolean;
}

interface ToastQueueHost {
  /** Hands an event to Base UI's provider, which owns the one toast that is on screen. */
  readonly deliver: (event: ToastQueueEvent) => void;
  /** Whether a provider is mounted to show toasts. Without one the queue keeps its state. */
  readonly isAttached: () => boolean;
  /** Whether keyboard focus is inside the visible toast; focus is never taken from it. */
  readonly hasFocusWithin: () => boolean;
  /** A toast scoped to another thread waits until that thread is open. */
  readonly isRenderable: (options: QueuedToastOptions) => boolean;
}

interface Entry {
  options: QueuedToastOptions;
  readonly seq: number;
  /** Raised while a provider was mounted: it belongs to that provider and goes when it unmounts. */
  readonly live: boolean;
  /** The delivery that is on screen now; flipped when the toast is sent back to the queue. */
  instance: { requeued: boolean } | null;
}

type ToastActionData = {
  readonly onRetry?: unknown;
  readonly additionalActions?: ReadonlyArray<unknown>;
  readonly secondaryActionProps?: unknown;
};

function hasAction(options: QueuedToastOptions): boolean {
  const data = (options.data ?? undefined) as ToastActionData | undefined;
  return (
    hasVisibleToastAction(options.actionProps) ||
    data?.onRetry !== undefined ||
    (data?.additionalActions?.length ?? 0) > 0 ||
    data?.secondaryActionProps !== undefined
  );
}

/** Errors and anything with an action outrank the rest and are announced as urgent. */
function toastOutranks(options: QueuedToastOptions): boolean {
  return options.type === "error" || hasAction(options);
}

/** An error with an action stays until it is dismissed or acted on. */
function toastIsPersistent(options: QueuedToastOptions): boolean {
  return options.type === "error" && hasAction(options);
}

/**
 * One toast is on screen at a time. Waiting toasts live here, outside Base UI's store, with no
 * timer: their time starts when they are shown. Errors and toasts with an action go first, and
 * take the screen from an ordinary toast unless focus is inside it. A waiting toast that is
 * closed still runs its `onClose` and `onRemove`.
 */
export class ToastQueue {
  private presented: Entry | null = null;
  private held: Entry[] = [];
  private seq = 0;
  private snapshot: readonly WaitingToast[] = [];
  private readonly listeners = new Set<() => void>();
  private advancing = false;
  /** Ids of notices that were folded into an identical one, mapped to the one that stands. */
  private readonly aliases = new Map<string, string>();

  constructor(private readonly host: ToastQueueHost) {}

  handle(event: ToastQueueEvent): void {
    event = this.resolveAlias(event);
    switch (event.action) {
      case "add":
        this.add(event.options);
        return;
      case "close":
        this.close(event.options.id);
        return;
      case "update":
        this.update(event.options.id, event.options.updates);
        return;
      case "promise":
        this.send(event);
        return;
    }
  }

  /** The provider unmounted: what it showed or was sent while mounted is gone with it. */
  detach(): void {
    this.presented = null;
    this.held = this.held.filter((item) => !item.live);
    this.aliases.clear();
    this.publish();
  }

  /** A provider mounted: its store is empty, so the toast that was on screen is shown again. */
  attach(): void {
    if (this.presented && this.host.isRenderable(this.presented.options)) {
      this.send({ action: "add", options: this.delivered(this.presented) });
    } else if (this.presented) {
      this.requeuePresented();
    }
    if (!this.presented) this.presentNext();
    this.publish();
  }

  getWaiting = (): readonly WaitingToast[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Shows a waiting toast now, sending the one on screen back to the queue. */
  promote(id: string): void {
    const entry = this.held.find((item) => item.options.id === id);
    if (!entry || !this.host.isRenderable(entry.options)) return;
    this.held = this.held.filter((item) => item !== entry);
    if (this.presented) this.requeuePresented();
    this.present(entry);
    this.publish();
  }

  /** Re-checks what may be shown, for example after the open thread changed. */
  refresh(): void {
    if (this.presented && !this.host.isRenderable(this.presented.options)) {
      this.requeuePresented();
    }
    if (!this.presented) this.presentNext();
    this.publish();
  }

  private resolveAlias(event: ToastQueueEvent): ToastQueueEvent {
    if (event.action === "close" && event.options.id !== undefined) {
      const id = this.aliases.get(event.options.id);
      return id === undefined ? event : { action: "close", options: { id } };
    }
    if (event.action === "update") {
      const id = this.aliases.get(event.options.id);
      return id === undefined ? event : { action: "update", options: { ...event.options, id } };
    }
    return event;
  }

  private findTwin(options: QueuedToastOptions): Entry | null {
    if (typeof options.title !== "string") return null;
    const same = (entry: Entry) =>
      entry.options.id !== options.id &&
      entry.options.type === options.type &&
      entry.options.title === options.title &&
      entry.options.description === options.description;
    if (this.presented && same(this.presented)) return this.presented;
    return this.held.find(same) ?? null;
  }

  private send(event: ToastQueueEvent): void {
    if (this.host.isAttached()) this.host.deliver(event);
  }

  private add(options: QueuedToastOptions): void {
    const heldIndex = this.held.findIndex((item) => item.options.id === options.id);
    if (heldIndex !== -1) {
      this.held[heldIndex]!.options = options;
      this.publish();
      return;
    }
    if (this.presented?.options.id === options.id) {
      this.presented.options = options;
      this.send({ action: "add", options: this.delivered(this.presented) });
      return;
    }
    const twin = this.findTwin(options);
    if (twin) {
      // The same message again is the same notice: it replaces the waiting one in place, or is
      // folded into the one on screen. Its id answers to the twin from then on.
      this.aliases.set(options.id, twin.options.id);
      if (twin === this.presented) {
        options.onClose?.();
        options.onRemove?.();
      } else {
        const replaced = twin.options;
        twin.options = { ...options, id: replaced.id };
        replaced.onClose?.();
        replaced.onRemove?.();
        this.publish();
      }
      return;
    }
    const entry: Entry = {
      options,
      seq: this.seq++,
      live: this.host.isAttached(),
      instance: null,
    };
    if (!this.host.isRenderable(options)) {
      this.held.push(entry);
      this.publish();
      return;
    }
    if (this.presented === null) {
      this.present(entry);
    } else if (this.shouldPreempt(entry)) {
      this.requeuePresented();
      this.present(entry);
    } else {
      this.held.push(entry);
    }
    this.publish();
  }

  private shouldPreempt(entry: Entry): boolean {
    return (
      this.presented !== null &&
      toastOutranks(entry.options) &&
      !toastOutranks(this.presented.options) &&
      !this.host.hasFocusWithin()
    );
  }

  private close(id: string | undefined): void {
    if (!this.host.isAttached()) {
      // Nothing is mounted to finish a close, so the queue finishes it.
      const closing = [
        ...(this.presented && (id === undefined || this.presented.options.id === id)
          ? [this.presented]
          : []),
        ...this.held.filter((item) => id === undefined || item.options.id === id),
      ];
      if (this.presented && closing.includes(this.presented)) this.presented = null;
      this.held = this.held.filter((item) => !closing.includes(item));
      for (const entry of closing) this.drop(entry);
      if (!this.presented) this.presentNext();
      this.publish();
      return;
    }
    if (id === undefined) {
      const waiting = this.held;
      this.held = [];
      for (const entry of waiting) this.drop(entry);
      this.send({ action: "close", options: {} });
      this.publish();
      return;
    }
    const entry = this.held.find((item) => item.options.id === id);
    if (entry) {
      this.held = this.held.filter((item) => item !== entry);
      this.drop(entry);
      this.publish();
      return;
    }
    this.send({ action: "close", options: { id } });
  }

  private update(id: string, updates: Record<string, unknown>): void {
    const entry = this.held.find((item) => item.options.id === id);
    if (entry) {
      entry.options = { ...entry.options, ...updates };
      if (this.presented && this.shouldPreempt(entry)) {
        this.held = this.held.filter((item) => item !== entry);
        this.requeuePresented();
        this.present(entry);
      }
      this.publish();
      return;
    }
    if (this.presented?.options.id === id) {
      const { onClose, onRemove, ...rest } = updates as {
        onClose?: (() => void) | undefined;
        onRemove?: (() => void) | undefined;
      } & Record<string, unknown>;
      this.presented.options = {
        ...this.presented.options,
        ...(onClose !== undefined ? { onClose } : {}),
        ...(onRemove !== undefined ? { onRemove } : {}),
      };
      this.send({ action: "update", options: { id, updates: rest } });
      return;
    }
    this.send({ action: "update", options: { id, updates } });
  }

  /** A waiting toast that is closed never reaches Base UI, so its callbacks run here. */
  private drop(entry: Entry): void {
    entry.options.onClose?.();
    entry.options.onRemove?.();
  }

  private present(entry: Entry): void {
    this.presented = entry;
    this.send({ action: "add", options: this.delivered(entry) });
  }

  private requeuePresented(): void {
    const entry = this.presented;
    if (!entry) return;
    this.presented = null;
    if (entry.instance) entry.instance.requeued = true;
    this.held.push(entry);
    this.send({ action: "close", options: { id: entry.options.id } });
  }

  private presentNext(): void {
    const next = this.pickNext();
    if (!next) return;
    this.held = this.held.filter((item) => item !== next);
    this.present(next);
  }

  private pickNext(): Entry | null {
    const renderable = this.held.filter((item) => this.host.isRenderable(item.options));
    const urgent = renderable.filter((item) => toastOutranks(item.options));
    const pool = urgent.length > 0 ? urgent : renderable;
    return pool.reduce<Entry | null>(
      (best, item) => (!best || item.seq < best.seq ? item : best),
      null,
    );
  }

  /** The options Base UI gets: timer rules and urgency applied, callbacks routed through the queue. */
  private delivered(entry: Entry): QueuedToastOptions {
    const instance = { requeued: false };
    entry.instance = instance;
    const { options } = entry;
    return {
      ...options,
      ...(toastIsPersistent(options) ? { timeout: 0 } : {}),
      onClose: () => {
        if (!instance.requeued) options.onClose?.();
        if (this.presented === entry && entry.instance === instance) {
          this.presented = null;
          // After Base UI has finished closing this one: the next is added outside its loop.
          this.scheduleAdvance();
        }
      },
      onRemove: () => {
        if (!instance.requeued) options.onRemove?.();
      },
    };
  }

  private scheduleAdvance(): void {
    if (this.advancing) return;
    this.advancing = true;
    queueMicrotask(() => {
      this.advancing = false;
      if (!this.presented) this.presentNext();
      this.publish();
    });
  }

  private publish(): void {
    const next = this.held
      .filter((item) => this.host.isRenderable(item.options))
      .sort(
        (a, b) =>
          Number(toastOutranks(b.options)) - Number(toastOutranks(a.options)) || a.seq - b.seq,
      )
      .map<WaitingToast>((item) => ({
        id: item.options.id,
        type: item.options.type,
        title: item.options.title,
        outranks: toastOutranks(item.options),
      }));
    const same =
      next.length === this.snapshot.length &&
      next.every((item, index) => {
        const previous = this.snapshot[index]!;
        return (
          previous.id === item.id &&
          previous.type === item.type &&
          previous.title === item.title &&
          previous.outranks === item.outranks
        );
      });
    if (same) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
