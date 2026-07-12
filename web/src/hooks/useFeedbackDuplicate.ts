import { useQuery } from "@tanstack/react-query";
import { checkFeedbackDuplicate } from "../api/client";

// The no-duplicate early check for one prospective (subject, provider, requester) triple —
// the create screens call it as soon as their triple is known, so the user is warned (with a
// link to the existing feedback) before filling anything. Pass null while the triple is
// incomplete. A check failure degrades to "no duplicate" (the server 409 stays the backstop).
export function useFeedbackDuplicate(
  triple: { subjectId: number; providerId: number; requesterId?: number } | null,
): { existingId: number | null; existingStatus: "DRAFT" | "REQUESTED" | null } {
  const query = useQuery({
    queryKey: [
      "feedbackDuplicate",
      triple?.subjectId ?? null,
      triple?.providerId ?? null,
      triple?.requesterId ?? null,
    ],
    queryFn: () => checkFeedbackDuplicate(triple!),
    enabled: triple != null,
  });
  return {
    existingId: query.data?.existingId ?? null,
    existingStatus: (query.data?.existingStatus as "DRAFT" | "REQUESTED" | undefined) ?? null,
  };
}
