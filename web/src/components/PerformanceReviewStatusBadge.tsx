import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/reviews";

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
  size?: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} size={size} style={{ minWidth: "max-content" }}>
      {t(`performanceReview.status.${status}`)}
    </Badge>
  );
}
