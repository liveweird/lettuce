import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listFeedbackEvents } from "../api/feedbacks";
import EventTimeline from "./EventTimeline";
import { describeFeedbackEvent } from "../utils/feedbackEventText";


/** The feedback's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function FeedbackHistory({ feedbackId }: { feedbackId: number }) {
  const { t } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["feedbackEvents", feedbackId],
    queryFn: () => listFeedbackEvents(feedbackId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("feedback.noHistory")}
      renderTitle={(e) => describeFeedbackEvent(e, t)}
    />
  );
}
