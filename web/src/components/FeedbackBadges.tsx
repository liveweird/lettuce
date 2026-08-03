import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { FeedbackStatus, FeedbackVisibility } from "../api/client";

// The single source of truth for feedback status colors — shared by the view/edit header
// (FeedbackMeta) and the list tables, so the pills stay coherent everywhere.
const STATUS_COLOR: Record<FeedbackStatus, string> = {
  REQUESTED: "blue",
  DRAFT: "gray",
  SENT: "teal",
  WITHDRAWN: "orange",
  REJECTED: "red",
};

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const { t } = useTranslation();
  return (
    <Badge color={STATUS_COLOR[status]} variant="light" style={{ minWidth: "max-content" }} aria-label={t("common.field.status")}>
      {t(`common.status.${status}`)}
    </Badge>
  );
}

export function VisibilityBadge({ visibility }: { visibility: FeedbackVisibility }) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" style={{ minWidth: "max-content" }} aria-label={t("common.field.visibility")}>
      {t(`common.visibility.${visibility}`)}
    </Badge>
  );
}
