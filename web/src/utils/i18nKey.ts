import type { ParseKeys } from "i18next";

/**
 * Brands a runtime-assembled translation key (wire enum values, server-provided names)
 * whose union TypeScript cannot see. i18next's missing-key fallback still guards typos at
 * runtime; use ONLY where the interpolated value is genuinely not a statically known union.
 */
export function dynamicKey(key: string): ParseKeys {
  return key as ParseKeys;
}
