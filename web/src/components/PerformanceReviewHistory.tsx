import { dynamicKey } from "../utils/i18nKey";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listPerformanceReviewEvents, type PerformanceReviewEvent } from "../api/reviews";
import EventTimeline from "./EventTimeline";

// Renders one structured event in the viewer's language. The server stores no strings — just
// the type + params (category/status enum names only; never summary text, and since v1.49.0
// never rating values — the ratings are encrypted at rest, history records the bare fact).
function describeEvent(e: PerformanceReviewEvent, t: TFunction): string {
  const p = e.params ?? {};
  const category = p.category ? t(dynamicKey(`performanceReview.category.${p.category.toLowerCase()}`)) : "";
  switch (e.type) {
    case "CREATED":
      return t("performanceReview.event.created");
    case "RATING_CHANGED":
      return t("performanceReview.event.ratingChanged", { category });
    case "SUMMARY_CHANGED":
      return t("performanceReview.event.summaryChanged", { category });
    case "STATUS_CHANGED":
      return t("performanceReview.event.statusChanged", {
        from: t(dynamicKey(`performanceReview.status.${p.from}`)),
        to: t(dynamicKey(`performanceReview.status.${p.to}`)),
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
      renderTitle={(e) => describeEvent(e, t)}
    />
  );
}
