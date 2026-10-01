import { useTranslation } from "react-i18next";
import type { ShareStatus } from "../api/shares";
import StatusPill from "./StatusPill";

// The single source of truth for share status colours (the per-area badge convention): the
// share dialog's "Current shares" list now, the Shared screen's tables next.
const STATUS_COLOR: Record<ShareStatus, string> = {
  ACTIVE: "teal",
  EXPIRED: "gray",
  WITHDRAWN: "orange",
};

export default function ShareStatusBadge({ status }: { status: ShareStatus }) {
  const { t } = useTranslation();
  return (
    <StatusPill color={STATUS_COLOR[status]} dot size="sm" ariaLabel={t("common.field.status")}>
      {t(`sharing.status.${status}`)}
    </StatusPill>
  );
}
