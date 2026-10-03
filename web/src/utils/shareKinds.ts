import type { TFunction } from "i18next";
import type { Feature } from "../api/session";
import type { ShareableResourceType, ShareResponse } from "../api/shares";
import { formatIsoDate, formatIsoDateRange, formatMonthRange } from "./datetime";
import { daysOffListLink } from "./daysOffLinks";
import { userDetailsLink } from "./userLinks";

/** The nine shareable kinds (v4.11.0 added the days-off calendar, v4.12.0 a team's pulse results), in the order the type filter lists them. */
export const SHARE_TYPES: readonly ShareableResourceType[] = [
  "FEEDBACK",
  "ONE_ON_ONE",
  "GOAL",
  "PERFORMANCE_REVIEW",
  "TEAM_KPI",
  "IMPACT_LOG_ENTRY",
  "SUCCESSION_PLAN",
  "DAYS_OFF_CALENDAR",
  "PULSE_TEAM_RESULTS",
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
  DAYS_OFF_CALENDAR: "DAYS_OFF",
  PULSE_TEAM_RESULTS: "PULSE_SURVEYS",
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
  DAYS_OFF_CALENDAR: ["person"],
  PULSE_TEAM_RESULTS: ["team"],
};

/**
 * The localized one-line description of a document from its content-free `details` facts (the
 * share snapshot vocabulary — also the activity log's), built per kind. Null details, or details
 * missing a key the kind needs, read "No longer available" rather than a half-filled sentence.
 */
export function documentLabel(
  resourceType: ShareableResourceType,
  d: Record<string, string> | null | undefined,
  t: TFunction,
  locale: string,
): string {
  if (d == null || REQUIRED_KEYS[resourceType].some((key) => d[key] == null)) {
    return t("sharing.doc.unavailable");
  }
  switch (resourceType) {
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
    case "DAYS_OFF_CALENDAR":
      return t("sharing.doc.DAYS_OFF_CALENDAR", { person: d.person });
    case "PULSE_TEAM_RESULTS":
      return t("sharing.doc.PULSE_TEAM_RESULTS", { team: d.team });
  }
}

/** The localized document label of a share row — the server sends facts, never text. */
export function shareDocumentLabel(share: ShareResponse, t: TFunction, locale: string): string {
  return documentLabel(share.resourceType, share.details, t, locale);
}

/** The i18next contexts that word the sharing dialog for a kind (undefined = the base "document" keys). */
export type ShareKindContext = "calendar" | "pulse" | undefined;

/**
 * The i18next context that words the sharing dialog and the withdraw confirm for the kind: a
 * days-off calendar (v4.11.0) says "calendar" and a team's pulse results (v4.12.0) "pulse results"
 * instead of the generic "document"; every other kind reads the base keys.
 */
export function shareKindContext(resourceType: ShareableResourceType): ShareKindContext {
  if (resourceType === "DAYS_OFF_CALENDAR") return "calendar";
  return resourceType === "PULSE_TEAM_RESULTS" ? "pulse" : undefined;
}

/** The facts of a share (or an activity share row) the Open target is derived from. */
type ShareOpenTarget = {
  resourceType: ShareableResourceType;
  resourceId: number;
  /** The server-derived path — the SHAREE's destination. */
  link: string;
  details?: Record<string, string> | null;
  /** Absent on an activity row (the log never names the sharee's id). */
  shareeId?: number | null;
};

/**
 * Where a share's Open action goes for THIS viewer. The server's `link` is the sharee's
 * destination — for every kind but a days-off calendar that is also the right target for the
 * sharer, the author and the HR auditor. A calendar's link is the sharee's "Shared with me" scope,
 * which holds nothing for them (the scope lists calendars shared WITH the viewer), so a viewer
 * who is not the sharee is sent to the person's details page instead (every authenticated user
 * may open it, and it carries the manager/HR days-off drill-down) — or, when the calendar is the
 * viewer's own, to the Calendar tab of their own days off. A pulse-results share (v4.12.0) is the
 * same story: the server's `link` is the sharee's "Shared with me" view of the Results tab, so any
 * other viewer (the sharer, the team's manager, an activity-log owner) is sent to the Results tab
 * with the team marked — the page picks the first of their own views that holds the team. The
 * caller appends `back=` (`shareOpenLink`).
 */
export function shareOpenPath(target: ShareOpenTarget, viewerId: number | null): string {
  if (target.resourceType === "PULSE_TEAM_RESULTS" && target.shareeId !== viewerId) {
    return `/pulse?tab=results&team=${target.resourceId}`;
  }
  if (target.resourceType !== "DAYS_OFF_CALENDAR" || target.shareeId === viewerId) return target.link;
  if (target.resourceId === viewerId) return daysOffListLink("calendar");
  return userDetailsLink(target.resourceId, target.details?.person);
}
