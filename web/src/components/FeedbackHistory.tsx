import { Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listFeedbackEvents } from "../api/client";
import { formatTimestamp } from "../utils/datetime";

/** The feedback's audit history as a timeline (oldest first), or an empty-state note. */
export default function FeedbackHistory({ feedbackId }: { feedbackId: number }) {
  const { t } = useTranslation();
  const { data: events } = useQuery({
    queryKey: ["feedbackEvents", feedbackId],
    queryFn: () => listFeedbackEvents(feedbackId),
  });

  if (!events || events.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("feedback.noHistory")}
      </Text>
    );
  }

  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {events.map((e) => (
        <Timeline.Item key={e.id} title={e.content}>
          <Text size="xs" c="dimmed">
            {e.userName} · {formatTimestamp(e.timestamp)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
