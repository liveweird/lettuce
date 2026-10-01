import { ApiError } from "../api/http";

// The problem `detail` the server answers (403) when a document is opened through shares that
// have all stopped working — the sharer lost the right to read it themselves
// (`SHARE_LAPSED_DETAIL` in sharing/ShareAccess.kt). The detail phrase is the contract: the lapse
// shares its status with the ordinary denial, so the view pages tell them apart by it (the
// login lockout's "sign-in codes" precedent).
const SHARE_LAPSED_DETAIL = "The person who shared this no longer has access to it";

/** True for the 403 that means "the share you were relying on has lapsed". */
export function isShareLapse(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.detail === SHARE_LAPSED_DETAIL;
}
