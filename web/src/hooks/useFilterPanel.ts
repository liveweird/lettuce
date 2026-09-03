import { isBoolean, useStoredState } from "./useStoredState";

/** The persisted open/collapsed state of a list's filter panel — one entry per view under
 *  `lettuce.viewSettings.<storageKey>.filtersOpen` (shared by FilterPanel and ListToolbar). */
export function useFilterPanel(storageKey: string): [boolean, (open: boolean) => void] {
  return useStoredState(`${storageKey}.filtersOpen`, false, isBoolean);
}
