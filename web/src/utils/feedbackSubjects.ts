import type { TFunction } from "i18next";

/** One party in a feedback's people line: its display name, and whether it is the current user. */
export type PartyDisplay = { display: string; isYou?: boolean };

/** One recipient as the API carries it (the `subjects` list, v3.1.0). */
export type FeedbackSubjectRef = { id: number; name: string; deleted?: boolean };

/**
 * The recipients of a feedback row/response: the position-ordered `subjects` list, falling
 * back to the legacy `subjectId`/`subjectName` pair when the list is absent (defensive —
 * every v3.1.0 response carries it). Every render site reads recipients through this.
 */
export function feedbackSubjects(row: {
  subjects?: FeedbackSubjectRef[];
  subjectId: number;
  subjectName?: string | null;
  subjectDeleted?: boolean;
}): FeedbackSubjectRef[] {
  if (row.subjects && row.subjects.length > 0) return row.subjects;
  return [{ id: row.subjectId, name: row.subjectName ?? `#${row.subjectId}`, deleted: row.subjectDeleted ?? false }];
}

/** The recipients' names joined for aria-labels ("View feedback for Ann, Ben"). */
export function feedbackSubjectNames(row: Parameters<typeof feedbackSubjects>[0]): string {
  return feedbackSubjects(row).map((s) => s.name).join(", ");
}

/**
 * The people-line entries (the view/edit MetaStrip cells since v3.5.0): each recipient's display name, the current user
 * rendered as the app-wide plain "You" (driven by the id, never by comparing strings).
 */
export function subjectDisplays(
  row: Parameters<typeof feedbackSubjects>[0],
  currentUserId: number | null,
  t: TFunction,
): { display: string; isYou: boolean }[] {
  return feedbackSubjects(row).map((s) => {
    const isYou = currentUserId != null && s.id === currentUserId;
    return { display: isYou ? t("common.state.you") : s.name, isYou };
  });
}
