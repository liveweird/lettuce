import type { ParseKeys, TFunction } from "i18next";
import { ApiError } from "../api/http";
import { saveErrorMessage, type SaveErrorKeys } from "./saveError";

/**
 * The share dialogs' shared failure → message skeleton (checkup #38 R5): the per-caller rate limit
 * (429) answers its own wording — the single dialog's and the batch dialog's differ, so the caller
 * names the key — and every other failure goes through the shared `saveErrorMessage` chain over the
 * caller's own key set (and the kind's i18next context).
 */
export function shareErrorMessage(
  err: unknown,
  t: TFunction,
  rateLimitedKey: ParseKeys,
  keys: SaveErrorKeys,
  context?: string,
): string {
  if (err instanceof ApiError && err.status === 429) return t(rateLimitedKey);
  return saveErrorMessage(err, t, keys, context);
}
