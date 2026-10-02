import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTeamKpiEvents, type TeamKpiType } from "../api/teamkpis";
import EventTimeline from "./EventTimeline";
import { describeTeamKpiEvent } from "../utils/teamKpiEventText";


/** The team KPI's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function TeamKpiHistory({ kpiId, type }: { kpiId: number; type: TeamKpiType }) {
  const { t, i18n } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["teamKpiEvents", kpiId],
    queryFn: () => listTeamKpiEvents(kpiId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("teamKpi.noHistory")}
      renderTitle={(e) => describeTeamKpiEvent(e, t, i18n.language, type)}
    />
  );
}
