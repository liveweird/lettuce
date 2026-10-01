import type { TFunction } from "i18next";
import type { Feature } from "../api/session";
import type { ShareableResourceType, ShareResponse } from "../api/shares";
import { formatIsoDate, formatIsoDateRange, formatMonthRange } from "./datetime";

/** The seven shareable kinds, in the order the type filter lists them. */
export const SHARE_TYPES: readonly ShareableResourceType[] = [
  "FEEDBACK",
  "ONE_ON_ONE",
  "GOAL",
  "PERFORMANCE_REVIEW",
  "TEAM_KPI",
  "IMPACT_LOG_ENTRY",
  "SUCCESSION_PLAN",
];

/** The per-user feature flag that gates each kind's screens (caller-only semantics). */
export const SHARE_FEATURE: Record<ShareableResourceType, Feature> = {
  FEEDBACK: "FEEDBACKS",
  ONE_ON_ONE: "ONE_ON_ONES",
  GOAL: "GOALS",
  PERFORMANCE_REVIEW: "PERFORMANCE_REVIEWS",
  TEAM_KPI: "TEAM_KPIS",
  IMPACT_LOG_ENTRY: "IMPACT_LOG",
  SUCCESSION_PLAN: "SUCCESSION_PLANS",
};

// The `details` snapshot keys each kind must carry for its label (the server contract —
// content-free, plaintext title/party columns only, taken once when the share was created).
const REQUIRED_KEYS: Record<ShareableResourceType, readonly string[]> = {
  FEEDBACK: ["provider", "subjects"],
  ONE_ON_ONE: ["manager", "subordinate", "meetingDate"],
  GOAL: ["title", "subordinate"],
  PERFORMANCE_REVIEW: ["subordinate", "startMonth", "endMonth"],
  TEAM_KPI: ["title", "team"],
  IMPACT_LOG_ENTRY: ["title", "author", "periodStart", "periodEnd"],
  SUCCESSION_PLAN: ["person", "owner"],
};

/**
 * The localized one-line description of a share's document, built from the `details` snapshot
 * (the server sends facts, never text). A row with no snapshot — or one missing a key its kind
 * needs — reads "No longer available" rather than a half-filled sentence.
 */
export function shareDocumentLabel(share: ShareResponse, t: TFunction, locale: string): string {
  const d = share.details;
  if (d == null || REQUIRED_KEYS[share.resourceType].some((key) => d[key] == null)) {
    return t("sharing.doc.unavailable");
  }
  switch (share.resourceType) {
    case "FEEDBACK":
      return t("sharing.doc.FEEDBACK", { provider: d.provider, subjects: d.subjects });
    case "ONE_ON_ONE":
      return t("sharing.doc.ONE_ON_ONE", {
        manager: d.manager,
        subordinate: d.subordinate,
        date: formatIsoDate(d.meetingDate, locale),
      });
    case "GOAL":
      return t("sharing.doc.GOAL", { title: d.title, subordinate: d.subordinate });
    case "PERFORMANCE_REVIEW":
      return t("sharing.doc.PERFORMANCE_REVIEW", {
        subordinate: d.subordinate,
        period: formatMonthRange(d.startMonth, d.endMonth, locale),
      });
    case "TEAM_KPI":
      return t("sharing.doc.TEAM_KPI", { title: d.title, team: d.team });
    case "IMPACT_LOG_ENTRY": {
      const period = formatIsoDateRange(d.periodStart, d.periodEnd, locale);
      // Pre-V66 entries have no title — the period carries the identity then.
      return d.title === ""
        ? t("sharing.doc.IMPACT_LOG_ENTRY_untitled", { author: d.author, period })
        : t("sharing.doc.IMPACT_LOG_ENTRY", { title: d.title, author: d.author, period });
    }
    case "SUCCESSION_PLAN":
      return t("sharing.doc.SUCCESSION_PLAN", { person: d.person, owner: d.owner });
  }
}
