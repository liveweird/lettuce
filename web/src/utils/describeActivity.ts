import type { TFunction } from "i18next";
import type { ActivityArea, ActivityEntry } from "../api/activity";
import type { ShareableResourceType } from "../api/shares";
import type { TeamKpiType } from "../api/teamkpis";
import { formatIsoDate } from "./datetime";
import { describeFeedbackEvent } from "./feedbackEventText";
import { describeGoalEvent } from "./goalEventText";
import { describeImpactLogEvent } from "./impactLogEventText";
import { dynamicKey } from "./i18nKey";
import { describeOneOnOneEvent } from "./oneOnOneEventText";
import { describePerformanceReviewEvent } from "./performanceReviewEventText";
import { describeSuccessionEvent } from "./successionEventText";
import { describeTeamKpiEvent } from "./teamKpiEventText";
import { SHARE_TYPES } from "./shareKinds";

/** The three dictionary-backed references a career position carries. */
export type CareerRef = "careerPath" | "careerSpecialization" | "seniorityLevel";
const CAREER_REFS: readonly CareerRef[] = ["careerPath", "careerSpecialization", "seniorityLevel"];

export type ActivityContext = {
  t: TFunction;
  locale: string;
  /**
   * The LIVE localized dictionary label of a career reference (`kind` + entry id), or undefined
   * when the entry is no longer active / the dictionary has not loaded — the describer then falls
   * back to the display name frozen on the event (the default language, as the server stored it).
   */
  careerLabel?: (kind: CareerRef, id: string) => string | undefined;
};

/**
 * True for the seven areas that name a document kind (the rows that carry a document label). The
 * days-off calendar kind is not an area of its own — its share rows ride the DAYS_OFF area.
 */
export function isDocumentArea(area: ActivityArea): area is Extract<ShareableResourceType, ActivityArea> {
  return (SHARE_TYPES as readonly string[]).includes(area);
}

/**
 * The document kind a row carries a label/link for: the seven document areas' rows, plus a
 * days-off CALENDAR share row (v4.11.0 — area DAYS_OFF, eventType SHARE_*; the area's own event
 * rows are person-scoped and carry no document). Null for every other row.
 */
export function activityDocumentKind(entry: ActivityEntry): ShareableResourceType | null {
  if (isDocumentArea(entry.area)) return entry.area;
  return entry.area === "DAYS_OFF" && entry.eventType.startsWith("SHARE_") ? "DAYS_OFF_CALENDAR" : null;
}

// Server values are raw Double strings ("2.0", "1.5"); format per locale, pass anything odd through.
function num(raw: string | undefined, locale: string): string {
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? new Intl.NumberFormat(locale).format(parsed) : (raw ?? "");
}

function date(iso: string | undefined, locale: string): string {
  return iso ? formatIsoDate(iso, locale) : "";
}

// The number a day count agrees with ("1 day" / "2 days" / PL "dzień/dni/dnia") — i18next picks
// the plural variant from `count`, while the text prints the locale-formatted `days` string.
function dayCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// A pool reference in the case the sentence needs (PL genitive "puli", accusative "pulę"); a
// frozen name that is missing reads as an unnamed pool instead of a quoted placeholder.
function poolRef(p: Record<string, string>, t: TFunction, accusative = false): string {
  const name = p.poolName;
  if (name != null && name !== "") return t(accusative ? "activity.pool.namedAcc" : "activity.pool.named", { name });
  return t(accusative ? "activity.pool.unnamedAcc" : "activity.pool.unnamed");
}

function shareSentence(entry: ActivityEntry, c: ActivityContext): string {
  const { t, locale } = c;
  const p = entry.params;
  const area = entry.area as ShareableResourceType;
  // A days-off calendar share names the person whose calendar it is (the stored snapshot's
  // `person`) — "Shared Pat's days-off calendar with Ben" — and a pulse-results share (v4.12.0) the
  // team (`team`) — "Shared the pulse survey results of AAA with Ben" — falling back to the generic noun.
  const kind = activityDocumentKind(entry);
  const person = kind === "DAYS_OFF_CALENDAR" ? entry.details?.person : undefined;
  const team = kind === "PULSE_TEAM_RESULTS" ? entry.details?.team : undefined;
  const suffix = person != null || team != null ? "_named" : "";
  const nounKey = dynamicKey(`activity.shareNoun.${area}${suffix}`);
  const nounOfKey = dynamicKey(`activity.shareNounOf.${area}${suffix}`);
  if (entry.eventType === "SHARE_CREATED") {
    return t("activity.event.shareCreated", {
      noun: t(nounKey, { person, team }),
      sharee: p.sharee ?? "",
      date: date(p.expiresOn, locale),
      context: p.expiresOn ? "until" : undefined,
    });
  }
  return t("activity.event.shareWithdrawn", {
    noun: t(nounOfKey, { person, team }),
    sharee: p.sharee ?? "",
    sharer: p.sharer ?? "",
    context: p.byAuthor === "true" ? "byAuthor" : undefined,
  });
}

// "paid, "Vacation" pool" / "paid" / "unpaid" — the kind clause of a days-off entry.
function daysOffKind(p: Record<string, string>, t: TFunction): string {
  if (p.type !== "PAID") return t("activity.kind.unpaid");
  return p.poolName != null && p.poolName !== ""
    ? t("activity.kind.paid", { pool: p.poolName })
    : t("activity.kind.paidUnnamed");
}

function correctionSummary(days: string | undefined, year: string | undefined, operation: string | undefined, c: ActivityContext): string {
  return c.t("activity.event.correctionSummary", {
    days: num(days, c.locale),
    count: dayCount(days),
    year: year ?? "",
    context: operation === "ADD" || operation === "SUBTRACT" ? operation : undefined,
  });
}

function daysOffSentence(entry: ActivityEntry, c: ActivityContext): string {
  const { t, locale } = c;
  const p = entry.params;
  const pool = poolRef(p, t);
  const op = p.operation === "ADD" || p.operation === "SUBTRACT" ? p.operation : undefined;
  switch (entry.eventType) {
    case "ENTRY_RECORDED":
    case "ENTRY_DELETED":
      return t(entry.eventType === "ENTRY_RECORDED" ? "activity.event.daysOffRecorded" : "activity.event.daysOffDeleted", {
        startDate: date(p.startDate, locale),
        endDate: date(p.endDate, locale),
        days: num(p.days, locale),
        count: dayCount(p.days),
        kind: daysOffKind(p, t),
      });
    case "CORRECTION_CREATED":
      return t("activity.event.correctionCreated", { days: num(p.days, locale), count: dayCount(p.days), pool, year: p.year ?? "", context: op });
    case "CORRECTION_DELETED":
      return t("activity.event.correctionDeleted", { days: num(p.days, locale), count: dayCount(p.days), pool, year: p.year ?? "", context: op });
    case "CORRECTION_UPDATED":
      return t("activity.event.correctionUpdated", {
        pool,
        from: correctionSummary(p.daysFrom, p.yearFrom, p.operationFrom, c),
        to: correctionSummary(p.daysTo, p.yearTo, p.operationTo, c),
      });
    case "ALLOWANCE_CHANGED":
      return t("activity.event.allowanceChanged", {
        pool,
        from: num(p.from, locale),
        to: num(p.to, locale),
        count: dayCount(p.to),
        context: p.from != null ? "from" : undefined,
      });
    case "POOL_ARCHIVED":
      return t("activity.event.poolArchived", {
        pool: poolRef(p, t, true),
        allowance: num(p.allowance, locale),
        count: dayCount(p.allowance),
      });
    default:
      return entry.eventType; // forward-compat: a kind this client build doesn't know yet
  }
}

// A career reference as shown: the live localized dictionary label by id when it is still active,
// else the display name frozen on the event, else undefined (the ref was unset).
function careerRef(
  p: Record<string, string>,
  kind: CareerRef,
  suffix: "" | "From" | "To",
  c: ActivityContext,
): string | undefined {
  const id = p[`${kind}${suffix}`];
  if (id == null) return undefined;
  return c.careerLabel?.(kind, id) ?? p[`${kind}${suffix}Name`] ?? `#${id}`;
}

function careerSentence(entry: ActivityEntry, c: ActivityContext): string {
  const { t, locale } = c;
  const p = entry.params;
  switch (entry.eventType) {
    case "POSITION_CREATED":
    case "POSITION_DELETED": {
      const position = CAREER_REFS.map((kind) => careerRef(p, kind, "", c))
        .filter((label): label is string => label != null)
        .join(" · ");
      return t(entry.eventType === "POSITION_CREATED" ? "activity.event.careerCreated" : "activity.event.careerDeleted", {
        startDate: date(p.startDate, locale),
        position,
        context: position === "" ? "empty" : undefined,
      });
    }
    case "POSITION_UPDATED": {
      const unset = t("activity.unset");
      const changes: string[] = [];
      if (p.startDateFrom != null || p.startDateTo != null) {
        changes.push(
          t("activity.event.careerStartChange", {
            from: p.startDateFrom ? date(p.startDateFrom, locale) : unset,
            to: p.startDateTo ? date(p.startDateTo, locale) : unset,
          }),
        );
      }
      for (const kind of CAREER_REFS) {
        // A ref counts as changed when either side is recorded (an unset side has no key at all).
        if (p[`${kind}From`] == null && p[`${kind}To`] == null) continue;
        changes.push(
          t("activity.event.careerRefChange", {
            label: t(dynamicKey(`common.field.${kind}`)),
            from: careerRef(p, kind, "From", c) ?? unset,
            to: careerRef(p, kind, "To", c) ?? unset,
          }),
        );
      }
      return t("activity.event.careerUpdated", { startDate: date(p.startDate, locale), changes: changes.join("; ") });
    }
    default:
      return entry.eventType;
  }
}

function accountSentence(entry: ActivityEntry, c: ActivityContext): string {
  if (entry.eventType === "SIGNED_IN") {
    return c.t("activity.event.signedIn", { context: entry.params.mfa === "true" ? "mfa" : undefined });
  }
  if (entry.eventType === "SIGNED_OUT") return c.t("activity.event.signedOut");
  return entry.eventType;
}

// The KPI's value type, from the row's label facts or the event params; when neither carries it
// (a share-row snapshot has none, an event row may be hidden) the values render BARE — a plain
// locale number with no unit — rather than guessing a "%" either way.
function kpiType(entry: ActivityEntry): TeamKpiType {
  const raw = entry.details?.type ?? entry.params.type;
  return raw === "PERCENTAGE" ? "PERCENTAGE" : "NUMBER";
}

/**
 * The localized, content-free sentence of one activity row — a neutral past-tense phrase with no
 * subject ("Signed in", "Shared a goal with Ann"), so it reads right in the person's own log and
 * in someone else's. Document rows dispatch to the SAME per-area describers the documents' own
 * History tabs use (the row's `params` is that event's map); share, days-off, career and account
 * rows have their own wording here. An event kind this build does not know renders its raw type.
 */
export function describeActivity(entry: ActivityEntry, c: ActivityContext): string {
  const { t, locale } = c;
  if (entry.eventType === "SHARE_CREATED" || entry.eventType === "SHARE_WITHDRAWN") {
    return shareSentence(entry, c);
  }
  // The describers take `{ type, params }` — an activity row is exactly that, with `eventType`.
  const event = { type: entry.eventType, params: entry.params };
  switch (entry.area) {
    case "FEEDBACK":
      return describeFeedbackEvent(event as Parameters<typeof describeFeedbackEvent>[0], t);
    case "GOAL":
      return describeGoalEvent(event as Parameters<typeof describeGoalEvent>[0], t, locale);
    case "ONE_ON_ONE": {
      // Item owners are named MANAGER/SUBORDINATE on the wire; name them from the row's label facts.
      // Without the label facts (an unreadable meeting) a neutral role word, never the enum.
      const ownerName = (owner: string) =>
        owner === "MANAGER"
          ? (entry.details?.manager ?? t("activity.role.manager"))
          : owner === "SUBORDINATE"
            ? (entry.details?.subordinate ?? t("activity.role.report"))
            : owner;
      return describeOneOnOneEvent(event as Parameters<typeof describeOneOnOneEvent>[0], t, locale, ownerName);
    }
    case "PERFORMANCE_REVIEW":
      return describePerformanceReviewEvent(event as Parameters<typeof describePerformanceReviewEvent>[0], t);
    case "IMPACT_LOG_ENTRY":
      return describeImpactLogEvent(event as Parameters<typeof describeImpactLogEvent>[0], t, locale);
    case "SUCCESSION_PLAN":
      return describeSuccessionEvent(event as Parameters<typeof describeSuccessionEvent>[0], t);
    case "TEAM_KPI":
      return describeTeamKpiEvent(event as Parameters<typeof describeTeamKpiEvent>[0], t, locale, kpiType(entry));
    case "DAYS_OFF":
      return daysOffSentence(entry, c);
    case "CAREER_POSITION":
      return careerSentence(entry, c);
    case "ACCOUNT":
      return accountSentence(entry, c);
    default:
      // Forward-compat: an area this client build doesn't know yet — show the raw event type.
      return (entry as ActivityEntry).eventType;
  }
}
