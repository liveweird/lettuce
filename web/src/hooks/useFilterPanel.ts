import { useState } from "react";
import { isBoolean, readStoredJson, writeStoredJson } from "./useStoredState";

/**
 * The open/collapsed state of a list's filter panel — persisted per view under
 * `lettuce.viewSettings.<storageKey>.filtersOpen` (shared by FilterPanel and ListToolbar).
 * Without a `storageKey` (a toolbar with no filter panel) the state is plain local state —
 * nothing is read from or written to storage, so filter-less toolbars never subscribe to a
 * phantom shared key.
 */
export function useFilterPanel(storageKey: string | undefined): [boolean, (open: boolean) => void] {
  const key = storageKey == null ? undefined : `${storageKey}.filtersOpen`;
  const [open, setOpen] = useState<boolean>(() => {
    if (key == null) return false;
    const stored = readStoredJson(key);
    return isBoolean(stored) ? stored : false;
  });

  function set(next: boolean) {
    setOpen(next);
    if (key != null) writeStoredJson(key, next);
  }

  return [open, set];
}
