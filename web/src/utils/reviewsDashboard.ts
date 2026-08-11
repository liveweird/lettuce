// The reviews-dashboard join: one row per subordinate in scope, matched with their review for
// the picked period (client-side — the org-bounded card-grid precedent). Pure, so the merge
// and the filter predicates are unit-testable without rendering.

import type { PerformanceReviewListItem } from "../api/client";
import { pickDictionaryValue } from "./dictionaryForm";
import { RATING_VALUES, type ReviewCategory } from "./reviewRatings";
import type { PersonCard, TeamRow } from "./teamRows";
import { groupTeamRows } from "./teamRows";

export type ReviewsDashboardRow = {
  person: PersonCard;
  /** The subordinate's review for the picked period, when one exists and is visible. */
  review: PerformanceReviewListItem | null;
};

export function buildReviewsDashboardRows(
  members: TeamRow[],
  reviews: PerformanceReviewListItem[],
): ReviewsDashboardRow[] {
  const bySubordinate = new Map(reviews.map((r) => [r.subordinateId, r]));
  return groupTeamRows(members)
    .map((person) => ({ person, review: bySubordinate.get(person.userId) ?? null }))
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
}

export type ReviewsDashboardFilters = {
  /** Team name (names, not ids — the card rows carry names; "" = all). */
  teamName: string;
  /** Dictionary entry ids as Select string values ("" = all). */
  careerPathId: string;
  careerSpecializationId: string;
  seniorityLevelId: string;
};

export const EMPTY_REVIEWS_DASHBOARD_FILTERS: ReviewsDashboardFilters = {
  teamName: "",
  careerPathId: "",
  careerSpecializationId: "",
  seniorityLevelId: "",
};

export function filterReviewsDashboardRows(
  rows: ReviewsDashboardRow[],
  filters: ReviewsDashboardFilters,
): ReviewsDashboardRow[] {
  return rows.filter(({ person }) => {
    if (filters.teamName && !person.teamNames.includes(filters.teamName)) return false;
    if (filters.careerPathId && String(person.careerPath?.id ?? "") !== filters.careerPathId) {
      return false;
    }
    if (
      filters.careerSpecializationId &&
      String(person.careerSpecialization?.id ?? "") !== filters.careerSpecializationId
    ) {
      return false;
    }
    if (
      filters.seniorityLevelId &&
      String(person.seniorityLevel?.id ?? "") !== filters.seniorityLevelId
    ) {
      return false;
    }
    return true;
  });
}

/** The distinct team names across the loaded rows, sorted — the team filter's options. */
export function teamNameOptions(rows: ReviewsDashboardRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.person.teamNames))].sort((a, b) => a.localeCompare(b));
}

export const REVIEWS_DASHBOARD_SORT_FIELDS = [
  "name",
  "team",
  "careerPath",
  "careerSpecialization",
  "seniorityLevel",
  "status",
  "attitude",
  "delivery",
  "skills",
  "overall",
] as const;
export type ReviewsDashboardSortField = (typeof REVIEWS_DASHBOARD_SORT_FIELDS)[number];

// Status sorts by lifecycle progress, not alphabetically; a missing review ranks below DRAFT.
const STATUS_RANK: Record<string, number> = { DRAFT: 1, CALIBRATION: 2, PUBLISHED: 3 };

const RATING_FIELDS: Partial<
  Record<ReviewsDashboardSortField, (r: ReviewsDashboardRow) => number | null>
> = {
  attitude: (r) => r.review?.attitudeRating ?? null,
  delivery: (r) => r.review?.deliveryRating ?? null,
  skills: (r) => r.review?.skillsRating ?? null,
  overall: (r) => r.review?.overallRating ?? null,
};

/**
 * Client-side sort over the joined rows (the data is composed client-side, so sorting is too).
 * Strings compare per locale with unset values last; ratings compare numerically with
 * unset/no-review rows LAST regardless of direction (a missing rating is "no data", not "the
 * lowest"); status by lifecycle rank. Input order (name-sorted by the builder) breaks ties.
 */
export function sortReviewsDashboardRows(
  rows: ReviewsDashboardRow[],
  field: ReviewsDashboardSortField,
  dir: "asc" | "desc",
  // The viewer's language — career columns sort by the DISPLAYED (localized) value.
  lang?: string,
): ReviewsDashboardRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const stringKey = (r: ReviewsDashboardRow): string | null => {
    switch (field) {
      case "name":
        return r.person.name;
      case "team":
        return r.person.teamNames[0] ?? null;
      case "careerPath":
        return r.person.careerPath ? pickDictionaryValue(r.person.careerPath, lang) : null;
      case "careerSpecialization":
        return r.person.careerSpecialization
          ? pickDictionaryValue(r.person.careerSpecialization, lang)
          : null;
      case "seniorityLevel":
        return r.person.seniorityLevel ? pickDictionaryValue(r.person.seniorityLevel, lang) : null;
      default:
        return null;
    }
  };
  const numericKey =
    field === "status"
      ? (r: ReviewsDashboardRow) => (r.review ? STATUS_RANK[r.review.status] ?? 0 : 0)
      : RATING_FIELDS[field];
  return [...rows].sort((a, b) => {
    if (numericKey) {
      const av = numericKey(a);
      const bv = numericKey(b);
      // Unset/no-review rows sink to the bottom in BOTH directions.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sign * (av - bv);
    }
    const av = stringKey(a);
    const bv = stringKey(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return sign * av.localeCompare(bv);
  });
}

/** One zero-filled bucket per rating value (1–6), for the distribution chart. */
export type RatingBucket = { rating: number; count: number };

/**
 * The distribution of one category's ratings across the (filtered) rows — the balance view's
 * data. Unrated people (no review, or that category unset) are excluded from the buckets and
 * reported via `rated`/`total` instead (the chart shows them as a caption, not a bar).
 */
export function ratingDistribution(
  rows: ReviewsDashboardRow[],
  category: ReviewCategory,
): { counts: RatingBucket[]; rated: number; total: number } {
  const accessor = RATING_FIELDS[category]!;
  const byRating = new Map<number, number>(RATING_VALUES.map((r) => [r, 0]));
  let rated = 0;
  for (const row of rows) {
    const rating = accessor(row);
    if (rating == null || !byRating.has(rating)) continue;
    byRating.set(rating, byRating.get(rating)! + 1);
    rated += 1;
  }
  return {
    counts: RATING_VALUES.map((rating) => ({ rating, count: byRating.get(rating)! })),
    rated,
    total: rows.length,
  };
}
