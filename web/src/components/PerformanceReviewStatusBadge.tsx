import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/reviews";
import StatusPill from "./StatusPill";

// One color per lifecycle stage: draft = neutral, calibration = in-progress attention,
// published = delivered (the GoalStatusBadge idiom).
const STATUS_COLORS: Record<PerformanceReviewStatus, string> = {
  DRAFT: "gray",
  CALIBRATION: "orange",
  PUBLISHED: "teal",
};

export default function PerformanceReviewStatusBadge({
  status,
  size,
}: {
  status: PerformanceReviewStatus;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  return (
    <StatusPill color={STATUS_COLORS[status]} size={size} dot>
      {t(`performanceReview.status.${status}`)}
    </StatusPill>
  );
}
