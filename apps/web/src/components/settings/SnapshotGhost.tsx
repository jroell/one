/** A window with a selection drawn on it and the chip it becomes, as a preview of a snapshot. */
export function SnapshotGhost({ label }: { readonly label: string }) {
  return (
    <div data-snapshot-ghost="" className="flex flex-col items-start gap-3">
      <div className="relative h-28 w-full rounded-lg border border-(--settings-description)">
        <div className="flex gap-1 px-3 pt-2.5">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1.5 rounded-full bg-(--settings-description)" />
          ))}
        </div>
        <div className="absolute inset-x-6 top-9 bottom-4 rounded-md border border-dashed border-(--settings-description)" />
      </div>
      <span className="rounded-full border border-(--settings-description) px-3 py-1 text-xs text-(--settings-description)">
        {label}
      </span>
    </div>
  );
}
