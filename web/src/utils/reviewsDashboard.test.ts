import { describe, expect, test } from "vitest";
import type { PerformanceReviewListItem } from "../api/client";
import {
  buildReviewsDashboardRows,
  EMPTY_REVIEWS_DASHBOARD_FILTERS,
  filterReviewsDashboardRows,
  teamNameOptions,
} from "./reviewsDashboard";
import type { TeamRow } from "./teamRows";

function member(userId: number, name: string, teamName: string, overrides: Partial<TeamRow> = {}): TeamRow {
  return { userId, name, email: `${name}@x`, teamName, ...overrides };
}

function review(subordinateId: number, overrides: Partial<PerformanceReviewListItem> = {}): PerformanceReviewListItem {
  return {
    id: subordinateId * 10,
    managerId: 1,
    managerName: "Mgr",
    managerDeleted: false,
    subordinateId,
    subordinateName: `S${subordinateId}`,
    subordinateDeleted: false,
    periodId: 4,
    periodStartMonth: "2026-01",
    periodEndMonth: "2026-06",
    status: "DRAFT",
    attitudeRating: 3,
    deliveryRating: null,
    skillsRating: null,
    overallRating: null,
    createdAt: 1,
    lastModified: 1,
    ...overrides,
  };
}

describe("reviewsDashboard", () => {
  test("joins one row per person (multi-team memberships deduped), sorted by name", () => {
    const rows = buildReviewsDashboardRows(
      [member(2, "Zoe", "AAA"), member(1, "Ann", "AAA"), member(1, "Ann", "BBB")],
      [review(1)],
    );
    expect(rows.map((r) => r.person.name)).toEqual(["Ann", "Zoe"]);
    expect(rows[0].person.teamNames).toEqual(["AAA", "BBB"]);
    expect(rows[0].review?.id).toBe(10);
    // Zoe has no review for the period — the "no review yet" state.
    expect(rows[1].review).toBeNull();
  });

  test("filters narrow by team name and career entry ids", () => {
    const rows = buildReviewsDashboardRows(
      [
        member(1, "Ann", "AAA", { careerPath: { id: 11, value: "Eng" } }),
        member(2, "Zoe", "BBB", { seniorityLevel: { id: 31, value: "Senior" } }),
      ],
      [],
    );
    expect(filterReviewsDashboardRows(rows, EMPTY_REVIEWS_DASHBOARD_FILTERS)).toHaveLength(2);
    expect(
      filterReviewsDashboardRows(rows, { ...EMPTY_REVIEWS_DASHBOARD_FILTERS, teamName: "BBB" })
        .map((r) => r.person.name),
    ).toEqual(["Zoe"]);
    expect(
      filterReviewsDashboardRows(rows, { ...EMPTY_REVIEWS_DASHBOARD_FILTERS, careerPathId: "11" })
        .map((r) => r.person.name),
    ).toEqual(["Ann"]);
    // An unset career value never matches a concrete filter.
    expect(
      filterReviewsDashboardRows(rows, {
        ...EMPTY_REVIEWS_DASHBOARD_FILTERS,
        careerSpecializationId: "21",
      }),
    ).toEqual([]);
    expect(
      filterReviewsDashboardRows(rows, {
        ...EMPTY_REVIEWS_DASHBOARD_FILTERS,
        seniorityLevelId: "31",
      }).map((r) => r.person.name),
    ).toEqual(["Zoe"]);
  });

  test("teamNameOptions collects the distinct sorted team names", () => {
    const rows = buildReviewsDashboardRows(
      [member(1, "Ann", "BBB"), member(1, "Ann", "AAA"), member(2, "Zoe", "BBB")],
      [],
    );
    expect(teamNameOptions(rows)).toEqual(["AAA", "BBB"]);
  });
});
