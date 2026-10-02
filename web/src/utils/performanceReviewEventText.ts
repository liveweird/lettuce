import { dynamicKey } from "./i18nKey";
import type { TFunction } from "i18next";
import type { PerformanceReviewEvent } from "../api/reviews";

// Renders one structured event in the viewer's language. The server stores no strings — just
// the type + params (category/status enum names only; never summary text, and since v1.49.0
// never rating values — the ratings are encrypted at rest, history records the bare fact).
export function describePerformanceReviewEvent(e: Pick<PerformanceReviewEvent, "type" | "params">, t: TFunction): string {
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
