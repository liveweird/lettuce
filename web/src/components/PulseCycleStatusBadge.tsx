import { useTranslation } from "react-i18next";
import type { PulseCycleStatus } from "../api/pulse";
import StatusPill from "./StatusPill";

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
    <StatusPill color={STATUS_COLOR[status]} dot>
      {t(`pulse.status.${status}`)}
    </StatusPill>
  );
}
