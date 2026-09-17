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

// The abbreviated-pill idiom (v3.10.2): the pill itself shows the SHORT form (keeps the list
// column compact), the full label rides `title` for a mouse-hover tooltip, and the accessible
// name is "<Field>: <full>" so assistive tech gets the value, not just the field name — the
// reference for any future column whose full label is too wide for a pill.
export function VisibilityBadge({ visibility }: { visibility: FeedbackVisibility }) {
  const { t } = useTranslation();
  const full = t(`common.visibility.${visibility}`);
  return (
    <StatusPill color="gray" title={full} ariaLabel={`${t("common.field.visibility")}: ${full}`}>
      {t(`common.visibilityShort.${visibility}`)}
    </StatusPill>
  );
}
