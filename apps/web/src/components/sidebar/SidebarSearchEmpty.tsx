import { useGT } from "gt-react";

import { Button } from "../ui/button";

export function SidebarSearchEmpty({
  status,
  onClear,
}: {
  readonly status: "pending" | "failed" | "empty";
  readonly onClear: () => void;
}) {
  const gt = useGT();
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
      <p role="status">
        {status === "pending"
          ? gt("Searching thread messages…")
          : status === "failed"
            ? gt("Couldn't search thread messages")
            : gt("No threads found")}
      </p>
      {status === "pending" ? null : (
        <Button size="xs" variant="outline" onClick={onClear}>
          {gt("Clear search")}
        </Button>
      )}
    </div>
  );
}
