import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listPerformanceReviewEvents } from "../api/reviews";
import EventTimeline from "./EventTimeline";
import { describePerformanceReviewEvent } from "../utils/performanceReviewEventText";


/** The review's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function PerformanceReviewHistory({ reviewId }: { reviewId: number }) {
  const { t } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["performanceReviewEvents", reviewId],
    queryFn: () => listPerformanceReviewEvents(reviewId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("performanceReview.noHistory")}
      renderTitle={(e) => describePerformanceReviewEvent(e, t)}
    />
  );
}
