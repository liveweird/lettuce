import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/reviews";
import { STATUS_COLORS } from "./performanceReviewStatusColors";
import StatusPill from "./StatusPill";

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
