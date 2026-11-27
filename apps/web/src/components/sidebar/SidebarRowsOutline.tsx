import { Skeleton } from "../ui/skeleton";
import { recalledSidebarRows, type SidebarOutlineRow } from "./sidebarRowsMemory";

// Heights of the real rows: a card is 52px (spacing 13) and a one-line row 36px (spacing 9).
const ROW_CLASS: Record<SidebarOutlineRow, string> = {
  card: "h-13",
  slim: "h-9",
};

/** A key for each row from its kind and how many of that kind came before it. */
function outlineKeys(rows: readonly SidebarOutlineRow[]) {
  const seen = { card: 0, slim: 0 };
  return rows.map((row) => ({ row, key: `${row}-${seen[row]++}` }));
}

/**
 * The list's place held while its rows load: last visit's rows, at the same heights, so the real
 * ones land without moving anything.
 */
export function SidebarRowsOutline() {
  return (
    <ul
      aria-hidden="true"
      data-sidebar-rows-outline=""
      className="flex flex-col gap-px px-1 py-0.5"
    >
      {outlineKeys(recalledSidebarRows()).map(({ key, row }) => (
        <li key={key} className={ROW_CLASS[row]}>
          <Skeleton shape="card" className="size-full" />
        </li>
      ))}
    </ul>
  );
}
