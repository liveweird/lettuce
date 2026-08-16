import { Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listFeedbackEvents, type FeedbackEvent } from "../api/feedbacks";
import { formatTimestamp } from "../utils/datetime";

// Render a structured audit event in the current language.
function describeEvent(e: FeedbackEvent, t: TFunction): string {
  const p = e.params ?? {};
  switch (e.type) {
    case "CREATED":
      return t("feedback.event.created", { context: p.status });
    case "DELETED":
      return t("feedback.event.deleted");
    case "STATUS_CHANGED":
      return t("feedback.event.statusChanged", {
        from: t(`common.status.${p.from}`),
        to: t(`common.status.${p.to}`),
      });
    case "CONTENT_UPDATED":
      return t("feedback.event.contentUpdated");
    case "CONTENT_AND_VISIBILITY_UPDATED":
      return t("feedback.event.contentAndVisibilityUpdated");
    case "VISIBILITY_CHANGED":
      return t("feedback.event.visibilityChanged", { to: t(`common.visibility.${p.to}`) });
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}

/** The feedback's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
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
        <Timeline.Item key={e.id} title={describeEvent(e, t)}>
          <Text size="xs" c="dimmed">
            {e.userName} · {formatTimestamp(e.timestamp)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
