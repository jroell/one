import { Skeleton } from "../ui/skeleton";

// The real sheet's measurements: a 240px rail (56px on a phone) of 36px items in four groups, a
// 48px header, and a centered 720px page whose title, purpose and first panel sit where the
// page's own do. Shown only when a page takes over 250ms to mount.
const keys = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, row) => `${prefix}-${row}`);
const RAIL_GROUPS = [
  { id: "app", rows: keys("app", 7) },
  { id: "agents", rows: keys("agents", 6) },
  { id: "code", rows: keys("code", 3) },
  { id: "connections", rows: keys("connections", 2) },
  { id: "more", rows: keys("more", 4) },
] as const;

function RailSkeleton() {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-1 border-e border-(--settings-hairline) bg-sidebar p-2 max-md:w-14">
      <Skeleton className="mb-2 h-8 w-full" />
      {RAIL_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1 pb-3">
          {group.id === "agents" || group.id === "code" || group.id === "connections" ? (
            <Skeleton className="mx-2 mb-1 h-3 w-16 max-md:hidden" />
          ) : null}
          {group.rows.map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SettingsSheetSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 min-w-0 flex-1">
      <RailSkeleton />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-(--settings-hairline) ps-5">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-8 px-5 pt-6 pb-12 sm:px-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          {["first", "second"].map((section) => (
            <div key={section} className="flex flex-col gap-2.5">
              <Skeleton className="mx-3 h-5 w-32" />
              <Skeleton shape="card" className="h-[8.5rem] w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
