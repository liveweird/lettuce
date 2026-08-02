import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/client";

// One color per lifecycle stage: draft = neutral, calibration = in-progress attention,
// published = delivered (the GoalStatusBadge idiom).
const STATUS_COLORS: Record<PerformanceReviewStatus, string> = {
  DRAFT: "gray",
  CALIBRATION: "orange",
  PUBLISHED: "green",
};

export default function PerformanceReviewStatusBadge({
  status,
}: {
  status: PerformanceReviewStatus;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} style={{ minWidth: "max-content" }}>
      {t(`performanceReview.status.${status}`)}
    </Badge>
  );
}
