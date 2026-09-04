import { useTranslation } from "react-i18next";
import type { FeedbackStatus, FeedbackVisibility } from "../api/feedbacks";
import StatusPill from "./StatusPill";

// The single source of truth for feedback status colors — shared by the view/edit header
// (the MetaStrip header) and the list tables, so the pills stay coherent everywhere.
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
    <StatusPill color={STATUS_COLOR[status]} dot ariaLabel={t("common.field.status")}>
      {t(`common.status.${status}`)}
    </StatusPill>
  );
}

export function VisibilityBadge({ visibility }: { visibility: FeedbackVisibility }) {
  const { t } = useTranslation();
  return (
    <StatusPill color="gray" ariaLabel={t("common.field.visibility")}>
      {t(`common.visibility.${visibility}`)}
    </StatusPill>
  );
}
