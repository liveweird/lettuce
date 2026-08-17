import type { TFunction } from "i18next";
import type { CareerPyramidItem, CareerPyramidPosition } from "../api/career";
import type { DictionaryEntry } from "../api/dictionaries";
import { pickLocalized } from "./localized";
import { foldDiacritics } from "./text";

// Pure helpers behind the Career → Team pyramid tab (v2.16.0): the endpoint returns the
// caller's subordinates unpaged — since v2.17.0 with each subordinate's FULL position
// history — and the SPA filters/sorts/pages/aggregates client-side, the ReviewsDashboard
// pattern. The time slider re-runs the SAME pipeline for a past `asOf` date: the as-of
// position is the one whose [start, end] interval covers the date (end inclusive — on the
// deactivation day the person still shows). A person with no as-of position shows as
// "Not set" only while ACTIVE; a deactivated one is dropped entirely (they are listed only
// while they actively held a position — user decision). Tenure semantics (user decision):
// "tenure at level" counts from the as-of position's start (any recorded position change
// resets it), "in the organization" from the FIRST recorded position (histories started
// empty in v2.15.0, so this is tenure-as-recorded, not necessarily the true hire date).

export type CareerPyramidRow = {
  userId: number;
  name: string;
  careerPath: DictionaryEntry | null;
  careerSpecialization: DictionaryEntry | null;
  seniorityLevel: DictionaryEntry | null;
  /** Locale-resolved display texts (null = not set) — filtering/sorting/grouping key on these. */
  pathText: string | null;
  specializationText: string | null;
  seniorityText: string | null;
  /** ISO anchors (null = no recorded positions). */
  currentPositionStart: string | null;
  organizationSince: string | null;
  /** Whole months from the anchors to today (null = not set). */
  levelMonths: number | null;
  organizationMonths: number | null;
};

/** Whole calendar months between two ISO dates (day-aware, floored at 0). */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/** The position held on [asOfIso] — interval match, end inclusive; strict ISO compares. */
function positionAsOf(
  positions: CareerPyramidPosition[],
  asOfIso: string,
): CareerPyramidPosition | null {
  for (let i = positions.length - 1; i >= 0; i--) {
    const p = positions[i];
    if (p.startDate <= asOfIso && (p.endDate == null || asOfIso <= p.endDate)) return p;
  }
  return null;
}

export function buildCareerPyramidRows(
  items: CareerPyramidItem[],
  locale: string | undefined,
  asOfIso: string,
): CareerPyramidRow[] {
  const rows: CareerPyramidRow[] = [];
  for (const item of items) {
    const asOfPos = positionAsOf(item.positions, asOfIso);
    // Deactivated people are listed only while they actively held a position.
    if (asOfPos == null && item.deactivated) continue;
    const firstStart = item.positions[0]?.startDate ?? null;
    const organizationSince = firstStart != null && firstStart <= asOfIso ? firstStart : null;
    rows.push({
      userId: item.userId,
      name: item.name,
      careerPath: asOfPos?.careerPath ?? null,
      careerSpecialization: asOfPos?.careerSpecialization ?? null,
      seniorityLevel: asOfPos?.seniorityLevel ?? null,
      pathText: asOfPos?.careerPath ? pickLocalized(asOfPos.careerPath.values, locale) : null,
      specializationText: asOfPos?.careerSpecialization
        ? pickLocalized(asOfPos.careerSpecialization.values, locale)
        : null,
      seniorityText: asOfPos?.seniorityLevel
        ? pickLocalized(asOfPos.seniorityLevel.values, locale)
        : null,
      currentPositionStart: asOfPos?.startDate ?? null,
      organizationSince,
      levelMonths: asOfPos ? monthsBetween(asOfPos.startDate, asOfIso) : null,
      organizationMonths: organizationSince ? monthsBetween(organizationSince, asOfIso) : null,
    });
  }
  return rows;
}

/** The "Not set" filter/bucket sentinel (never collides with an entry id or display text). */
export const NOT_SET = "__notSet__";

// Entry-id strings, the ReviewsDashboard filter idiom ("" = all, NOT_SET = missing value);
// the name is a substring, matched accent-insensitively like the server-side list filters.
export type CareerPyramidFilters = {
  name: string;
  careerPathId: string;
  careerSpecializationId: string;
  seniorityLevelId: string;
};

export const EMPTY_CAREER_PYRAMID_FILTERS: CareerPyramidFilters = {
  name: "",
  careerPathId: "",
  careerSpecializationId: "",
  seniorityLevelId: "",
};

function matchesEntry(entry: DictionaryEntry | null, filter: string): boolean {
  if (filter === "") return true;
  if (filter === NOT_SET) return entry == null;
  return String(entry?.id ?? "") === filter;
}

export function filterCareerPyramidRows(
  rows: CareerPyramidRow[],
  filters: CareerPyramidFilters,
): CareerPyramidRow[] {
  const name = foldDiacritics(filters.name.trim());
  return rows.filter(
    (r) =>
      (name === "" || foldDiacritics(r.name).includes(name)) &&
      matchesEntry(r.careerPath, filters.careerPathId) &&
      matchesEntry(r.careerSpecialization, filters.careerSpecializationId) &&
      matchesEntry(r.seniorityLevel, filters.seniorityLevelId),
  );
}

export const CAREER_PYRAMID_SORT_FIELDS = [
  "name",
  "careerPath",
  "careerSpecialization",
  "seniorityLevel",
  "levelSince",
  "organizationSince",
] as const;
export type CareerPyramidSortField = (typeof CAREER_PYRAMID_SORT_FIELDS)[number];

// Tenure fields sort by the underlying ISO anchor: an EARLIER date means a LONGER tenure, so
// ascending "levelSince" = longest tenure first (reads naturally for a pyramid review).
// Null (not set) always sorts last regardless of direction.
export function sortCareerPyramidRows(
  rows: CareerPyramidRow[],
  field: CareerPyramidSortField,
  dir: "asc" | "desc",
): CareerPyramidRow[] {
  const key = (r: CareerPyramidRow): string | null =>
    field === "name"
      ? r.name
      : field === "careerPath"
        ? r.pathText
        : field === "careerSpecialization"
          ? r.specializationText
          : field === "seniorityLevel"
            ? r.seniorityText
            : field === "levelSince"
              ? r.currentPositionStart
              : r.organizationSince;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka == null && kb == null) return a.name.localeCompare(b.name);
    if (ka == null) return 1;
    if (kb == null) return -1;
    return sign * ka.localeCompare(kb) || a.name.localeCompare(b.name);
  });
}

/** Humanized tenure — "3 years 2 months", "1 year", "under a month"; localized plurals. */
export function formatTenure(months: number, t: TFunction): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0 && rest === 0) return t("career.tenure.underMonth");
  const parts: string[] = [];
  if (years > 0) parts.push(t("career.tenure.year", { count: years }));
  if (rest > 0) parts.push(t("career.tenure.month", { count: rest }));
  return parts.join(" ");
}

export const CHART_METRICS = [
  "careerPath",
  "careerSpecialization",
  "seniorityLevel",
  "tenureAtLevel",
  "tenureInOrganization",
] as const;
export type CareerChartMetric = (typeof CHART_METRICS)[number];

const TENURE_BUCKETS = ["lt1", "y1to2", "y2to5", "y5to10", "y10plus"] as const;
export type TenureBucket = (typeof TENURE_BUCKETS)[number];

export function tenureBucket(months: number): TenureBucket {
  if (months < 12) return "lt1";
  if (months < 24) return "y1to2";
  if (months < 60) return "y2to5";
  if (months < 120) return "y5to10";
  return "y10plus";
}

export type CareerDistributionBar = {
  /** A display text (categorical metrics), a TenureBucket id, or NOT_SET. */
  key: string;
  count: number;
};

/**
 * Distribution of one metric over the FILTERED rows (the chart shares the table's filters).
 * Categorical metrics: one bar per distinct value, count-descending (ties alphabetical);
 * tenure metrics: the fixed bucket order. "Not set" is always the last bar (only when
 * someone actually lacks the value); empty buckets are dropped for categorical metrics but
 * kept for tenure so the shape of the pyramid stays comparable across teams.
 */
export function buildCareerDistribution(
  rows: CareerPyramidRow[],
  metric: CareerChartMetric,
): CareerDistributionBar[] {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const row of rows) {
    if (metric === "tenureAtLevel" || metric === "tenureInOrganization") {
      const months = metric === "tenureAtLevel" ? row.levelMonths : row.organizationMonths;
      bump(months == null ? NOT_SET : tenureBucket(months));
    } else {
      const text =
        metric === "careerPath"
          ? row.pathText
          : metric === "careerSpecialization"
            ? row.specializationText
            : row.seniorityText;
      bump(text ?? NOT_SET);
    }
  }
  const notSet = counts.get(NOT_SET) ?? 0;
  counts.delete(NOT_SET);
  const bars: CareerDistributionBar[] =
    metric === "tenureAtLevel" || metric === "tenureInOrganization"
      ? TENURE_BUCKETS.map((b) => ({ key: b, count: counts.get(b) ?? 0 }))
      : [...counts.entries()]
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (notSet > 0) bars.push({ key: NOT_SET, count: notSet });
  return bars;
}
