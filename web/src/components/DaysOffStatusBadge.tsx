import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { DaysOffStatus } from "../api/daysoff";

// The single color source for days-off statuses (the GoalStatusBadge analogue): pending is
// yellow, accepted is the semantic-success teal, rejected red, cancelled a neutral gray.
const STATUS_COLORS: Record<DaysOffStatus, string> = {
  REQUESTED: "yellow",
  ACCEPTED: "teal",
  REJECTED: "red",
  CANCELLED: "gray",
};

export default function DaysOffStatusBadge({ status }: { status: DaysOffStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={STATUS_COLORS[status]} style={{ minWidth: "max-content" }}>
      {t(`daysOff.status.${status}`)}
    </Badge>
  );
}
