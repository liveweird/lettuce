import type { ParseKeys, TFunction } from "i18next";
import { ApiError } from "../api/http";

/**
 * The i18n keys a page maps save/mutation failures onto. Statuses without a key fall through:
 * an ApiError with no matching status key lands on `failedStatus` (when provided), else on
 * `failed`; a non-ApiError (network) failure always lands on `failed`.
 */
export interface SaveErrorKeys {
  /** 403. Omit only when the page routes a 403 through the generic fallbacks. */
  forbidden?: ParseKeys;
  /** 404 — omit to route it through the generic fallbacks. */
  notFound?: ParseKeys;
  /** 409 — omit to route it through the generic fallbacks. */
  conflict?: ParseKeys;
  /** 400 — omit to route it through the generic fallbacks. */
  invalid?: ParseKeys;
  /** Any otherwise-unmatched ApiError status; interpolates {{status}}. */
  failedStatus?: ParseKeys;
  /** Generic + network fallback. */
  failed: ParseKeys;
}

/**
 * The shared status→message mapping for save/mutation errors — replaces the per-page
 * hand-rolled `err instanceof ApiError` chains. Field-level cases (e.g. a 409 that becomes a
 * `form.setFieldError`) stay at the call site, handled before delegating here.
 */
export function saveErrorMessage(
  err: unknown,
  t: TFunction,
  keys: SaveErrorKeys,
): string {
  if (err instanceof ApiError) {
    if (err.status === 403 && keys.forbidden) return t(keys.forbidden);
    if (err.status === 404 && keys.notFound) return t(keys.notFound);
    if (err.status === 409 && keys.conflict) return t(keys.conflict);
    if (err.status === 400 && keys.invalid) return t(keys.invalid);
    if (keys.failedStatus) return t(keys.failedStatus, { status: err.status });
  }
  return t(keys.failed);
}
