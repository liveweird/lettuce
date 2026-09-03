import { useTranslation } from "react-i18next";
import type { DaysOffStatus } from "../api/daysoff";
import StatusPill from "./StatusPill";

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
    <StatusPill color={STATUS_COLORS[status]} dot>
      {t(`daysOff.status.${status}`)}
    </StatusPill>
  );
}
