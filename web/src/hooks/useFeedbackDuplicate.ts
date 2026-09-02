import { useQueries, useQuery } from "@tanstack/react-query";
import { checkFeedbackDuplicate } from "../api/feedbacks";

type DuplicateStatus = "DRAFT" | "REQUESTED";
type DuplicateResult = { existingId: number | null; existingStatus: DuplicateStatus | null };

// One query key shape for every probe, so utils/feedbackQueries.ts's `["feedbackDuplicate"]`
// prefix invalidation reaches the single- and the per-recipient hooks alike.
function duplicateKey(subjectId: number | null, providerId: number | null, requesterId: number | null) {
  return ["feedbackDuplicate", subjectId, providerId, requesterId] as const;
}

function toResult(data: { existingId?: number | null; existingStatus?: string | null } | undefined): DuplicateResult {
  return {
    existingId: data?.existingId ?? null,
    existingStatus: (data?.existingStatus as DuplicateStatus | undefined) ?? null,
  };
}

// The no-duplicate early check for one prospective (subject, provider, requester) triple —
// the create screens call it as soon as their triple is known, so the user is warned (with a
// link to the existing feedback) before filling anything. Pass null while the triple is
// incomplete. A check failure degrades to "no duplicate" (the server 409 stays the backstop).
export function useFeedbackDuplicate(
  triple: { subjectId: number; providerId: number; requesterId?: number } | null,
): DuplicateResult {
  const query = useQuery({
    queryKey: duplicateKey(triple?.subjectId ?? null, triple?.providerId ?? null, triple?.requesterId ?? null),
    queryFn: () => checkFeedbackDuplicate(triple!),
    enabled: triple != null,
  });
  return toResult(query.data);
}

/**
 * The per-recipient sibling for the multi-recipient picker (v3.1.0): one probe per picked
 * subject (the duplicate rule is per recipient — an open draft naming ANY of them blocks the
 * create), returned in the same order as `subjectIds`. Empty while nothing is picked.
 */
export function useFeedbackDuplicates(
  subjectIds: number[],
  providerId: number | null,
): { subjectId: number; result: DuplicateResult }[] {
  const queries = useQueries({
    queries: subjectIds.map((subjectId) => ({
      queryKey: duplicateKey(subjectId, providerId, null),
      queryFn: () => checkFeedbackDuplicate({ subjectId, providerId: providerId! }),
      enabled: providerId != null,
    })),
  });
  return subjectIds.map((subjectId, index) => ({ subjectId, result: toResult(queries[index]?.data) }));
}
