import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { PulseCycleStatus } from "../api/client";

// OPEN is the semantic-success teal (never stock green — the theme rule); SCHEDULED is the
// forward-looking blue; the terminal states stay muted/red.
const STATUS_COLOR: Record<PulseCycleStatus, string> = {
  SCHEDULED: "blue",
  OPEN: "teal",
  CLOSED: "gray",
  CANCELLED: "red",
};

export default function PulseCycleStatusBadge({ status }: { status: PulseCycleStatus }) {
  const { t } = useTranslation();
  return (
    // min-width keeps Mantine from silently ellipsizing the pill in table cells.
    <Badge color={STATUS_COLOR[status]} variant="light" style={{ minWidth: "max-content" }}>
      {t(`pulse.status.${status}`)}
    </Badge>
  );
}
