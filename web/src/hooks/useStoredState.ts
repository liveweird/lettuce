import { useState } from "react";

const PREFIX = "lettuce.viewSettings.";

/**
 * A `useState` that persists to localStorage (under `lettuce.viewSettings.<key>`) and restores
 * on mount, so a list view's filters/sort survive navigation and reloads. `isValid` guards
 * against stale or corrupt stored values (e.g. an enum value that no longer exists) — anything
 * failing it falls back to `initial`. Storage errors are swallowed on both paths: persistence
 * is best-effort and must never break a page.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  isValid: (v: unknown) => boolean,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw != null) {
        const parsed = JSON.parse(raw) as unknown;
        if (isValid(parsed)) return parsed as T;
      }
    } catch {
      // Unreadable storage / corrupt JSON — fall through to the default.
    }
    return initial;
  });

  function set(next: T) {
    setValue(next);
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(next));
    } catch {
      // Best-effort persistence only.
    }
  }

  return [value, set];
}

/** Validator for plain string state (the text filters). */
export const isString = (v: unknown): v is string => typeof v === "string";

/** Validator factory for nullable single-select state: null or one of the allowed values. */
export function isOneOfOrNull<T extends string>(values: readonly T[]) {
  return (v: unknown): v is T | null => v === null || values.includes(v as T);
}
