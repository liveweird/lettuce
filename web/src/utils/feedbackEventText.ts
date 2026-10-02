import { dynamicKey } from "./i18nKey";
import type { TFunction } from "i18next";
import type { FeedbackEvent } from "../api/feedbacks";

// Render a structured audit event in the current language.
export function describeFeedbackEvent(e: Pick<FeedbackEvent, "type" | "params">, t: TFunction): string {
  const p = e.params ?? {};
  switch (e.type) {
    case "CREATED":
      return t("feedback.event.created", { context: p.status });
    case "DELETED":
      return t("feedback.event.deleted");
    case "STATUS_CHANGED":
      return t("feedback.event.statusChanged", {
        from: t(dynamicKey(`common.status.${p.from}`)),
        to: t(dynamicKey(`common.status.${p.to}`)),
      });
    case "CONTENT_UPDATED":
      return t("feedback.event.contentUpdated");
    case "CONTENT_AND_VISIBILITY_UPDATED":
      return t("feedback.event.contentAndVisibilityUpdated");
    case "VISIBILITY_CHANGED":
      return t("feedback.event.visibilityChanged", { to: t(dynamicKey(`common.visibility.${p.to}`)) });
    case "REQUEST_EXPIRED":
      return t("feedback.event.requestExpired");
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}
