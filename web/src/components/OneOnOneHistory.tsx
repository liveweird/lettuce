import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listOneOnOneEvents } from "../api/oneonones";
import EventTimeline from "./EventTimeline";
import { describeOneOnOneEvent } from "../utils/oneOnOneEventText";


/** The 1:1 meeting's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function OneOnOneHistory({
  meetingId,
  managerName,
  subordinateName,
}: {
  meetingId: number;
  managerName: string;
  subordinateName: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["oneOnOneEvents", meetingId],
    queryFn: () => listOneOnOneEvents(meetingId),
  });

  const ownerName = (owner: string) =>
    owner === "MANAGER" ? managerName : owner === "SUBORDINATE" ? subordinateName : owner;

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("oneOnOne.noHistory")}
      renderTitle={(e) => describeOneOnOneEvent(e, t, i18n.language, ownerName)}
    />
  );
}
