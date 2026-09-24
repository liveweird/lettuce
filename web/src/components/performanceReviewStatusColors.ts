import type { PerformanceReviewStatus } from "../api/reviews";

// One color per lifecycle stage: draft = neutral, calibration = in-progress attention,
// published = delivered (the GoalStatusBadge idiom). Its own module (the tourSupport
// Fast-Refresh split) so PerformanceReviewStatusBadge.tsx stays component-only and
// PersonCardStats' last-review row (the status dot, no room for a full pill) can reuse this
// map rather than duplicating it.
export const STATUS_COLORS: Record<PerformanceReviewStatus, string> = {
  DRAFT: "gray",
  CALIBRATION: "orange",
  PUBLISHED: "teal",
};
