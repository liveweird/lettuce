import type { TFunction } from "i18next";
// Renders one of a feedback's user-typed fields (provider / requester / subject).
// Shows the translated "You" when the field's user is the logged-in user; otherwise
// the display name, with a deleted suffix for soft-deleted users, falling back to an
// em dash when there is no name. The self check wins over the deleted suffix — a
// logged-in user is never soft-deleted.
export function feedbackPartyName(
  userId: number | null | undefined,
  name: string | null | undefined,
  deleted: boolean,
  currentUserId: number | null,
  t: TFunction,
): string {
  if (currentUserId != null && userId === currentUserId) return t("common.state.you");
  if (name == null) return "—";
  return deleted ? t("feedback.deletedSuffix", { name }) : name;
}
