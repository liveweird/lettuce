// The reviews-dashboard join: one row per subordinate in scope, matched with their review for
// the picked period (client-side — the org-bounded card-grid precedent). Pure, so the merge
// and the filter predicates are unit-testable without rendering.

import type { PerformanceReviewListItem } from "../api/client";
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
