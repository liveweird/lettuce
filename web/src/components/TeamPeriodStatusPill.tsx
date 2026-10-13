import { useTranslation } from "react-i18next";
import StatusPill from "./StatusPill";
import type { PeriodStatus } from "../utils/teamPeriods";

const PILL_COLOR = { current: "teal", past: "gray", upcoming: "blue" } as const;

/** The Current / Past / Upcoming pill of a dated team period (v4.17.0). */
export default function TeamPeriodStatusPill({ status }: { status: PeriodStatus }) {
  const { t } = useTranslation();
  return (
    <StatusPill color={PILL_COLOR[status]} dot>
      {t(`teams.history.status.${status}`)}
    </StatusPill>
  );
}
