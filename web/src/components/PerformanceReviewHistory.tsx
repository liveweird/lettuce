import { Loader, Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listPerformanceReviewEvents, type PerformanceReviewEvent } from "../api/reviews";
import { formatTimestamp } from "../utils/datetime";

// Renders one structured event in the viewer's language. The server stores no strings — just
// the type + params (category/status enum names only; never summary text, and since v1.49.0
// never rating values — the ratings are encrypted at rest, history records the bare fact).
function describeEvent(e: PerformanceReviewEvent, t: TFunction): string {
  const p = e.params ?? {};
  const category = p.category ? t(`performanceReview.category.${p.category.toLowerCase()}`) : "";
  switch (e.type) {
    case "CREATED":
      return t("performanceReview.event.created");
    case "RATING_CHANGED":
      return t("performanceReview.event.ratingChanged", { category });
    case "SUMMARY_CHANGED":
      return t("performanceReview.event.summaryChanged", { category });
    case "STATUS_CHANGED":
      return t("performanceReview.event.statusChanged", {
        from: t(`performanceReview.status.${p.from}`),
        to: t(`performanceReview.status.${p.to}`),
      });
    case "DELETED":
      return t("performanceReview.event.deleted");
    default:
      return e.type; // forward-compat: an unknown kind — show the raw type
  }
}

/** The review's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function PerformanceReviewHistory({ reviewId }: { reviewId: number }) {
  const { t } = useTranslation();
  const { data: events, isLoading } = useQuery({
    queryKey: ["performanceReviewEvents", reviewId],
    queryFn: () => listPerformanceReviewEvents(reviewId),
  });

  if (isLoading) return <Loader size="sm" />;
  if (!events || events.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("performanceReview.noHistory")}
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
