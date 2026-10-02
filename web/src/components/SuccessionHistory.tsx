import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listSuccessionPlanEvents } from "../api/successionPlans";
import EventTimeline from "./EventTimeline";
import { describeSuccessionEvent } from "../utils/successionEventText";


/** The Review screen's History tab: the plan's audit trail, localized client-side. */
export default function SuccessionHistory({ planId }: { planId: number }) {
  const { t } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["successionPlanEvents", planId],
    queryFn: () => listSuccessionPlanEvents(planId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("succession.noHistory")}
      renderTitle={(e) => describeSuccessionEvent(e, t)}
    />
  );
}
