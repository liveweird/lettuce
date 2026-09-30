import { useTranslation } from "react-i18next";
import type { FeedbackStatus, FeedbackVisibility } from "../api/feedbacks";
import { IconLock, IconWorld } from "@tabler/icons-react";
import classes from "./FeedbackBadges.module.css";
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

// Visibility is a small but consequential access rule, so the label is written out rather than
// encoded as initials. The title and accessible name repeat the exact localized value.
export function VisibilityBadge({ visibility }: { visibility: FeedbackVisibility }) {
  const { t } = useTranslation();
  const full = t(`common.visibility.${visibility}`);
  return (
    <span className={classes.visibility} title={full} aria-label={`${t("common.field.visibility")}: ${full}`}>
      {visibility === "PUBLIC" ? <IconWorld size={14} aria-hidden="true" /> : <IconLock size={14} aria-hidden="true" />}
      <span>{full}</span>
    </span>
  );
}
