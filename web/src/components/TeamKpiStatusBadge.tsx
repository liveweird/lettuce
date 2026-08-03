import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { TeamKpiStatus } from "../api/client";

// The single color source for team-KPI statuses (the GoalStatusBadge analogue — split off in
// v1.29.0 when the KPI vocabulary diverged: the terminal state is ARCHIVED, not CLOSED).
const STATUS_COLORS: Record<TeamKpiStatus, string> = {
  DRAFT: "gray",
  ACTIVE: "teal",
  ARCHIVED: "dark",
};

export default function TeamKpiStatusBadge({ status }: { status: TeamKpiStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} style={{ minWidth: "max-content" }}>
      {t(`teamKpi.status.${status}`)}
    </Badge>
  );
}
