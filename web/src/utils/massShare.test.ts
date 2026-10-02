import { describe, expect, test } from "vitest";
import type { ShareCandidate } from "../api/reviews";
import type { ShareBatchItem } from "../api/shares";
import {
  buildMassShareRows,
  deselectMatching,
  EMPTY_MASS_SHARE_FILTERS,
  filterMassShareRows,
  managerOptions,
  MASS_SHARE_SORT_FIELDS,
  MASS_SHARE_STATUS_VALUES,
  MASS_SHARE_UNSET,
  reasonKey,
  retainUnsettled,
  rowStatus,
  selectAllMatching,
  selectedReviewIds,
  submittableRows,
  sortMassShareRows,
  subtreeUserIds,
  summarizeBatchResult,
  teamOptions,
  type MassShareFilters,
  type MassShareRow,
} from "./massShare";

const entry = (id: number, en: string) => ({ id, values: { en } });

type Overrides = Partial<ShareCandidate>;

function cand(userId: number, name: string, o: Overrides = {}): ShareCandidate {
  return {
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s/g, ".")}@x.test`,
    deactivated: false,
    teams: [],
    directManagers: [],
    careerPath: null,
    careerSpecialization: null,
    seniorityLevel: null,
    review: {
      id: userId * 10,
      status: "DRAFT",
      managerId: 1,
      managerName: "Me",
      attitudeRating: null,
      deliveryRating: null,
      skillsRating: null,
      aptitudeRating: null,
      overallRating: null,
    },
    shareable: true,
    reason: null,
    ...o,
  };
}

const noReview = { review: null, shareable: false, reason: "NO_REVIEW" as const };
const stub = {
  review: {
    id: null,
    status: "DRAFT" as const,
    managerId: null,
    managerName: "Olga Other",
    attitudeRating: null,
    deliveryRating: null,
    skillsRating: null,
    aptitudeRating: null,
    overallRating: null,
  },
  shareable: false,
  reason: "UNREADABLE_DRAFT" as const,
};
const rated = (userId: number, overallRating: number | null, status: "DRAFT" | "CALIBRATION" | "PUBLISHED" = "PUBLISHED") => ({
  review: {
    id: userId * 10,
    status,
    managerId: 1,
    managerName: "Me",
    attitudeRating: null,
    deliveryRating: null,
    skillsRating: null,
    aptitudeRating: null,
    overallRating,
  },
});

const ME = 1;
const mgr = (id: number, name: string) => ({ id, name });

// Caller (id 1) manages Mia (2, team Alpha); Mia manages Ned (3) and Oz (4); Ned manages Pam (5).
// Quinn (6) reports to a dotted-line outsider Rex (90) and to the caller.
function dataset(): MassShareRow[] {
  return buildMassShareRows(
    [
      cand(5, "Pam Pine", { teams: [{ id: 2, name: "Beta" }], directManagers: [mgr(3, "Ned Nest")], ...rated(5, 2) }),
      cand(2, "Mia Miller", {
        teams: [{ id: 1, name: "Alpha" }],
        directManagers: [mgr(ME, "Me Caller")],
        careerPath: entry(10, "Engineering"),
        seniorityLevel: entry(30, "Senior"),
        ...rated(2, 5),
      }),
      cand(3, "Ned Nest", {
        teams: [{ id: 2, name: "Beta" }],
        directManagers: [mgr(2, "Mia Miller")],
        careerPath: entry(10, "Engineering"),
        careerSpecialization: entry(20, "Backend"),
        ...rated(3, 3, "CALIBRATION"),
      }),
      cand(4, "Oz Oak", { teams: [{ id: 2, name: "Beta" }], directManagers: [mgr(2, "Mia Miller")], ...noReview }),
      cand(6, "Łukasz Quinn", {
        teams: [{ id: 3, name: "Gamma" }, { id: 1, name: "Alpha" }],
        directManagers: [mgr(ME, "Me Caller"), mgr(90, "Rex Outsider")],
        deactivated: true,
        ...stub,
      }),
    ],
    ME,
    "You",
  );
}

const ids = (rows: MassShareRow[]) => rows.map((r) => r.candidate.userId);
const f = (o: Partial<MassShareFilters>): MassShareFilters => ({ ...EMPTY_MASS_SHARE_FILTERS, ...o });

describe("massShare rows", () => {
  test("builds name-sorted rows with team names and the caller labelled in the manager column", () => {
    const rows = dataset();
    expect(ids(rows)).toEqual([6, 2, 3, 4, 5]);
    const quinn = rows[0];
    expect(quinn.teamNames).toEqual(["Gamma", "Alpha"]);
    expect(quinn.managerLabel).toBe("You, Rex Outsider");
    expect(rows[2].managerLabel).toBe("Mia Miller");
  });

  test("rowStatus and reasonKey classify a review, no review and another manager's draft", () => {
    const rows = dataset();
    const by = (id: number) => rows.find((r) => r.candidate.userId === id)!;
    expect(rowStatus(by(3))).toBe("CALIBRATION");
    expect(rowStatus(by(4))).toBe("NO_REVIEW");
    expect(rowStatus(by(6))).toBe("DRAFT");
    expect(reasonKey(by(3))).toBeNull();
    expect(reasonKey(by(4))).toBe("noReview");
    expect(reasonKey(by(6))).toBe("draftBy");
  });
});

describe("subtreeUserIds", () => {
  test("is the fixpoint over directManagers: two levels deep, the manager excluded", () => {
    const rows = dataset();
    expect([...subtreeUserIds(rows, 2)].sort()).toEqual([3, 4, 5]);
    expect([...subtreeUserIds(rows, 3)]).toEqual([5]);
    expect([...subtreeUserIds(rows, 5)]).toEqual([]);
  });

  test("a manager outside the dataset (the caller, a dotted-line outsider) roots a subtree too", () => {
    const rows = dataset();
    expect([...subtreeUserIds(rows, 90)]).toEqual([6]);
    expect([...subtreeUserIds(rows, ME)].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  test("survives a management cycle without looping and never lists the root", () => {
    const rows = buildMassShareRows(
      [
        cand(2, "A", { directManagers: [mgr(3, "B")] }),
        cand(3, "B", { directManagers: [mgr(2, "A")] }),
      ],
      ME,
      "You",
    );
    expect([...subtreeUserIds(rows, 2)]).toEqual([3]);
  });
});

describe("filterMassShareRows", () => {
  const rows = dataset();

  test("no facets and a blank query keep everyone", () => {
    expect(filterMassShareRows(rows, EMPTY_MASS_SHARE_FILTERS, "  ")).toHaveLength(5);
  });

  test("team names match any of a person's teams (OR within the facet)", () => {
    expect(ids(filterMassShareRows(rows, f({ teamNames: ["Alpha"] }), ""))).toEqual([6, 2]);
    expect(ids(filterMassShareRows(rows, f({ teamNames: ["Gamma", "Beta"] }), ""))).toEqual([6, 3, 4, 5]);
  });

  test("a direct-manager facet keeps the whole subtree, several managers union", () => {
    expect(ids(filterMassShareRows(rows, f({ managerIds: ["3"] }), ""))).toEqual([5]);
    expect(ids(filterMassShareRows(rows, f({ managerIds: ["2"] }), ""))).toEqual([3, 4, 5]);
    expect(ids(filterMassShareRows(rows, f({ managerIds: ["3", "90"] }), ""))).toEqual([6, 5]);
  });

  test("career facets match by entry id, and 'unset' matches the people without a value", () => {
    expect(ids(filterMassShareRows(rows, f({ careerPathIds: ["10"] }), ""))).toEqual([2, 3]);
    expect(ids(filterMassShareRows(rows, f({ careerPathIds: [MASS_SHARE_UNSET] }), ""))).toEqual([6, 4, 5]);
    expect(ids(filterMassShareRows(rows, f({ careerPathIds: ["10", MASS_SHARE_UNSET] }), ""))).toHaveLength(5);
    expect(ids(filterMassShareRows(rows, f({ careerSpecializationIds: ["20"] }), ""))).toEqual([3]);
    expect(ids(filterMassShareRows(rows, f({ seniorityLevelIds: ["30"] }), ""))).toEqual([2]);
    expect(ids(filterMassShareRows(rows, f({ seniorityLevelIds: [MASS_SHARE_UNSET] }), ""))).toEqual([6, 3, 4, 5]);
  });

  test("status includes the no-review pseudo status and the other manager's draft stub", () => {
    expect(ids(filterMassShareRows(rows, f({ statuses: ["NO_REVIEW"] }), ""))).toEqual([4]);
    expect(ids(filterMassShareRows(rows, f({ statuses: ["DRAFT", "CALIBRATION"] }), ""))).toEqual([6, 3]);
    expect(ids(filterMassShareRows(rows, f({ statuses: ["PUBLISHED"] }), ""))).toEqual([2, 5]);
  });

  test("overall rating at least X drops lower, absent and unreadable ratings", () => {
    expect(ids(filterMassShareRows(rows, f({ minOverall: "3" }), ""))).toEqual([2, 3]);
    expect(ids(filterMassShareRows(rows, f({ minOverall: "6" }), ""))).toEqual([]);
    expect(ids(filterMassShareRows(rows, f({ minOverall: "1" }), ""))).toEqual([2, 3, 5]);
  });

  test("search folds case and accents over name and email", () => {
    expect(ids(filterMassShareRows(rows, EMPTY_MASS_SHARE_FILTERS, "lukasz"))).toEqual([6]);
    expect(ids(filterMassShareRows(rows, EMPTY_MASS_SHARE_FILTERS, "ŁUKASZ"))).toEqual([6]);
    expect(ids(filterMassShareRows(rows, EMPTY_MASS_SHARE_FILTERS, "NED.NEST@"))).toEqual([3]);
    expect(ids(filterMassShareRows(rows, EMPTY_MASS_SHARE_FILTERS, "nobody"))).toEqual([]);
  });

  test("facets AND together", () => {
    expect(ids(filterMassShareRows(rows, f({ teamNames: ["Beta"], statuses: ["PUBLISHED"], minOverall: "2" }), ""))).toEqual([5]);
    expect(ids(filterMassShareRows(rows, f({ managerIds: ["2"], careerPathIds: ["10"] }), "ned"))).toEqual([3]);
  });
});

describe("options", () => {
  const rows = dataset();

  test("teamOptions is the distinct sorted team names", () => {
    expect(teamOptions(rows)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("managerOptions lists every distinct manager, the caller first as 'You'", () => {
    expect(managerOptions(rows, ME, "You")).toEqual([
      { value: "1", label: "You" },
      { value: "2", label: "Mia Miller" },
      { value: "3", label: "Ned Nest" },
      { value: "90", label: "Rex Outsider" },
    ]);
  });
});

describe("sortMassShareRows", () => {
  const rows = dataset();

  test("name and team sort per locale in both directions, no team sinks last", () => {
    expect(ids(sortMassShareRows(rows, "name", "desc", "en"))).toEqual([5, 4, 3, 2, 6]);
    const noTeam = buildMassShareRows([cand(7, "Zed"), cand(8, "Amy", { teams: [{ id: 1, name: "Alpha" }] })], ME, "You");
    expect(ids(sortMassShareRows(noTeam, "team", "asc"))).toEqual([8, 7]);
    expect(ids(sortMassShareRows(noTeam, "team", "desc"))).toEqual([8, 7]);
  });

  test("status sorts by lifecycle rank (no review lowest)", () => {
    expect(ids(sortMassShareRows(rows, "status", "asc"))).toEqual([4, 6, 3, 2, 5]);
    expect(ids(sortMassShareRows(rows, "status", "desc"))).toEqual([2, 5, 3, 6, 4]);
  });

  test("overall sorts numerically with unrated rows last in either direction", () => {
    expect(ids(sortMassShareRows(rows, "overall", "asc"))).toEqual([5, 3, 2, 6, 4]);
    expect(ids(sortMassShareRows(rows, "overall", "desc"))).toEqual([2, 3, 5, 6, 4]);
  });

  test("every whitelisted sort field returns a permutation of the rows", () => {
    for (const field of MASS_SHARE_SORT_FIELDS) {
      expect(ids(sortMassShareRows(rows, field, "asc")).sort()).toEqual(ids(rows).sort());
    }
  });

  test("every status facet value selects exactly the rows with that status", () => {
    const seen = MASS_SHARE_STATUS_VALUES.map((status) => ids(filterMassShareRows(rows, f({ statuses: [status] }), "")));
    expect(seen).toEqual([[4], [6], [3], [2, 5]]);
  });

  test("does not mutate its input", () => {
    const before = ids(rows);
    sortMassShareRows(rows, "overall", "desc");
    expect(ids(rows)).toEqual(before);
  });
});

describe("selection helpers", () => {
  const rows = dataset();

  test("selectAllMatching adds only the shareable filtered rows to the existing selection", () => {
    const filtered = filterMassShareRows(rows, f({ teamNames: ["Beta", "Gamma"] }), "");
    // 6 (other manager's draft) and 4 (no review) are in the filtered set but not shareable.
    expect([...selectAllMatching(new Set([2]), filtered)].sort()).toEqual([2, 3, 5]);
    expect([...selectAllMatching(new Set(), [])]).toEqual([]);
  });

  test("deselectMatching removes the filtered rows and keeps the rest", () => {
    const filtered = filterMassShareRows(rows, f({ teamNames: ["Beta"] }), "");
    expect([...deselectMatching(new Set([2, 3, 5]), filtered)]).toEqual([2]);
  });

  test("selectedReviewIds returns review ids in row order, never for unshareable people", () => {
    expect(selectedReviewIds(rows, new Set([5, 2, 4, 6]))).toEqual([20, 50]);
  });

  test("submittableRows are exactly the selected rows selectedReviewIds submits", () => {
    const selected = new Set([5, 2, 4, 6]);
    const submitted = submittableRows(rows, selected);
    expect(submitted.map((r) => r.candidate.userId)).toEqual([2, 5]);
    expect(submitted.map((r) => r.candidate.review?.id)).toEqual(selectedReviewIds(rows, selected));
    expect(submittableRows(rows, new Set())).toEqual([]);
  });

  test("retainUnsettled keeps failed and unanswered people, drops created and already-shared ones", () => {
    const items: ShareBatchItem[] = [
      { resourceId: 20, shareeId: 8, status: "CREATED", shareId: 1 },
      { resourceId: 20, shareeId: 9, status: "ALREADY_SHARED", shareId: 2 },
      { resourceId: 30, shareeId: 8, status: "CREATED", shareId: 3 },
      { resourceId: 30, shareeId: 9, status: "CREATED", shareId: 4 },
      { resourceId: 50, status: "NOT_FOUND" },
    ];
    // Person 2 (review 20) and 3 (review 30) settled; 5 (review 50) failed; none answered for 7.
    const extra = buildMassShareRows([cand(7, "Unsent")], ME, "You");
    const next = retainUnsettled(new Set([2, 3, 5, 7]), [...rows, ...extra], items);
    expect([...next].sort()).toEqual([5, 7]);
  });
});

describe("summarizeBatchResult", () => {
  const rows = dataset();
  const names = new Map([
    [8, "Bob"],
    [9, "Cy"],
  ]);

  test("counts created pairs and groups already-shared per person and failures with the reason", () => {
    const items: ShareBatchItem[] = [
      { resourceId: 50, shareeId: 8, status: "CREATED", shareId: 1 },
      { resourceId: 50, shareeId: 9, status: "CREATED", shareId: 2 },
      { resourceId: 30, shareeId: 8, status: "ALREADY_SHARED", shareId: 3 },
      { resourceId: 30, shareeId: 9, status: "ALREADY_SHARED", shareId: 4 },
      { resourceId: 20, shareeId: 8, status: "ALREADY_SHARED", shareId: 5 },
      { resourceId: 999, status: "FORBIDDEN" },
      { resourceId: 888, status: "NOT_FOUND" },
    ];
    expect(summarizeBatchResult(items, rows, names)).toEqual({
      created: 2,
      alreadyShared: [
        { resourceId: 20, person: "Mia Miller", sharees: ["Bob"] },
        { resourceId: 30, person: "Ned Nest", sharees: ["Bob", "Cy"] },
      ],
      failed: [
        { resourceId: 888, person: "#888", reason: "NOT_FOUND" },
        { resourceId: 999, person: "#999", reason: "FORBIDDEN" },
      ],
    });
  });

  test("an unknown sharee id falls back to its number, an empty report is all zeros", () => {
    expect(
      summarizeBatchResult([{ resourceId: 20, shareeId: 77, status: "ALREADY_SHARED", shareId: 1 }], rows, names)
        .alreadyShared,
    ).toEqual([{ resourceId: 20, person: "Mia Miller", sharees: ["#77"] }]);
    expect(summarizeBatchResult([], rows, names)).toEqual({ created: 0, alreadyShared: [], failed: [] });
  });
});
