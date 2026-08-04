import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GoalStatus } from "../api/client";

// The single color source for goal statuses (the goal analogue of FeedbackBadges' StatusBadge —
// kept separate because the two features' status vocabularies are unrelated).
const STATUS_COLORS: Record<GoalStatus, string> = {
  DRAFT: "gray",
  ACTIVE: "teal",
  ARCHIVED: "dark",
};

export default function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} style={{ minWidth: "max-content" }}>
      {t(`goal.status.${status}`)}
    </Badge>
  );
}
