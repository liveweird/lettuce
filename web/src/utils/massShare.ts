// The mass-share picker's pure core: one row per person of the caller's reporting line (the
// share-candidates read), the client-side facets, the sort, the selection helpers and the batch
// result summary. All client-side — there is no server filtering over seniority/career/ratings
// (ratings are encrypted at rest), and the dataset is bounded by the caller's own chain. Pure, so
// every predicate is unit-testable without rendering (the reviewsDashboard.ts shape).

import type { ShareBatchItem } from "../api/shares";
import type { ShareCandidate } from "../api/reviews";
import type { LocalizedEntry } from "./localized";
import { foldDiacritics } from "./text";

export type MassShareRow = {
  candidate: ShareCandidate;
  /** The person's team names, name-ascending (the server order). */
  teamNames: string[];
  /** Direct managers joined for display; the caller reads as the supplied "You" label. */
  managerLabel: string;
};

/** The dictionary facets' "no value recorded" option (the pyramid's "Not set" idiom). */
export const MASS_SHARE_UNSET = "unset";

/** The review-status facet values — "no review" is a status of its own. */
export const MASS_SHARE_STATUS_VALUES = ["NO_REVIEW", "DRAFT", "CALIBRATION", "PUBLISHED"] as const;
export type MassShareStatus = (typeof MASS_SHARE_STATUS_VALUES)[number];

export type MassShareFilters = {
  /** Team names (the rows carry names; empty = all). */
  teamNames: string[];
  /** Manager user ids as strings — each keeps that manager's whole SUBTREE (empty = all). */
  managerIds: string[];
  /** Dictionary entry ids as strings, or MASS_SHARE_UNSET (empty = all). */
  careerPathIds: string[];
  careerSpecializationIds: string[];
  seniorityLevelIds: string[];
  statuses: MassShareStatus[];
  /** "1".."6" = overall rating at least this ("" = off). Rows without a readable overall drop. */
  minOverall: string;
};

export const EMPTY_MASS_SHARE_FILTERS: MassShareFilters = {
  teamNames: [],
  managerIds: [],
  careerPathIds: [],
  careerSpecializationIds: [],
  seniorityLevelIds: [],
  statuses: [],
  minOverall: "",
};

export function buildMassShareRows(
  candidates: readonly ShareCandidate[],
  currentUserId: number | null,
  youLabel: string,
): MassShareRow[] {
  return candidates
    .map((candidate) => ({
      candidate,
      teamNames: candidate.teams.map((team) => team.name),
      managerLabel: candidate.directManagers
        .map((m) => (m.id === currentUserId ? youLabel : m.name))
        .join(", "),
    }))
    .sort((a, b) => a.candidate.name.localeCompare(b.candidate.name));
}

/** The review's status, or "NO_REVIEW" — the status facet/sort/badge key of a row. */
export function rowStatus(row: MassShareRow): MassShareStatus {
  return row.candidate.review?.status ?? "NO_REVIEW";
}

/** The review id to send — only a shareable row has one (a stub's id is null by contract). */
function shareableReviewId(row: MassShareRow): number | null {
  return row.candidate.shareable ? (row.candidate.review?.id ?? null) : null;
}

/** Why a row cannot be selected: no review, or another manager's draft. Null when shareable. */
export function reasonKey(row: MassShareRow): "noReview" | "draftBy" | null {
  switch (row.candidate.reason) {
    case "NO_REVIEW":
      return "noReview";
    case "UNREADABLE_DRAFT":
      return "draftBy";
    default:
      return null;
  }
}

/**
 * Everyone under `managerId`, any depth: the fixpoint over the `directManagers` edges within the
 * dataset. The manager need not be a row (the caller, a dotted-line manager outside the chain) and
 * is never part of their own subtree.
 */
export function subtreeUserIds(rows: readonly MassShareRow[], managerId: number): Set<number> {
  const subtree = new Set<number>();
  const underSubtree = new Set<number>([managerId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { candidate } of rows) {
      if (subtree.has(candidate.userId)) continue;
      if (candidate.directManagers.some((m) => underSubtree.has(m.id))) {
        subtree.add(candidate.userId);
        underSubtree.add(candidate.userId);
        grew = true;
      }
    }
  }
  subtree.delete(managerId);
  return subtree;
}

function entryMatches(entry: LocalizedEntry | null, selected: string[]): boolean {
  if (selected.length === 0) return true;
  if (entry == null) return selected.includes(MASS_SHARE_UNSET);
  return selected.includes(String(entry.id));
}

/** Applies every facet (AND across facets, OR within one) plus the folded name/email search. */
export function filterMassShareRows(
  rows: readonly MassShareRow[],
  filters: MassShareFilters,
  nameQuery: string,
): MassShareRow[] {
  const query = foldDiacritics(nameQuery.trim());
  let inManagerSubtrees: Set<number> | null = null;
  if (filters.managerIds.length > 0) {
    inManagerSubtrees = new Set();
    for (const id of filters.managerIds) {
      for (const userId of subtreeUserIds(rows, Number(id))) inManagerSubtrees.add(userId);
    }
  }
  const minOverall = filters.minOverall === "" ? null : Number(filters.minOverall);
  return rows.filter((row) => {
    const c = row.candidate;
    if (query && !foldDiacritics(c.name).includes(query) && !foldDiacritics(c.email).includes(query)) {
      return false;
    }
    if (filters.teamNames.length > 0 && !row.teamNames.some((n) => filters.teamNames.includes(n))) {
      return false;
    }
    if (inManagerSubtrees && !inManagerSubtrees.has(c.userId)) return false;
    if (!entryMatches(c.careerPath, filters.careerPathIds)) return false;
    if (!entryMatches(c.careerSpecialization, filters.careerSpecializationIds)) return false;
    if (!entryMatches(c.seniorityLevel, filters.seniorityLevelIds)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(rowStatus(row))) return false;
    if (minOverall != null) {
      const overall = c.review?.overallRating ?? null;
      if (overall == null || overall < minOverall) return false;
    }
    return true;
  });
}

/** The distinct team names across the rows, sorted — the team facet's options. */
export function teamOptions(rows: readonly MassShareRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.teamNames))].sort((a, b) => a.localeCompare(b));
}

/**
 * The direct-manager facet's options: every distinct `directManagers` entry across the rows (the
 * caller labelled `youLabel` and listed first, the rest by name). Values are user ids as strings.
 */
export function managerOptions(
  rows: readonly MassShareRow[],
  currentUserId: number | null,
  youLabel: string,
): { value: string; label: string }[] {
  const byId = new Map<number, string>();
  for (const { candidate } of rows) {
    for (const m of candidate.directManagers) byId.set(m.id, m.name);
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, label: id === currentUserId ? youLabel : name }))
    .sort((a, b) =>
      a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : a.label.localeCompare(b.label),
    )
    .map(({ id, label }) => ({ value: String(id), label }));
}

export const MASS_SHARE_SORT_FIELDS = ["name", "team", "status", "overall"] as const;
export type MassShareSortField = (typeof MASS_SHARE_SORT_FIELDS)[number];

// Lifecycle progress, not alphabet; "no review" ranks below DRAFT.
const STATUS_RANK: Record<MassShareStatus, number> = {
  NO_REVIEW: 0,
  DRAFT: 1,
  CALIBRATION: 2,
  PUBLISHED: 3,
};

/**
 * Client-side sort. Name/team compare per the viewer's locale (no team sinks last in both
 * directions); status by lifecycle rank; overall numerically with unreadable/absent ratings LAST in
 * both directions ("no data" is not "the lowest"). Input order breaks ties.
 */
export function sortMassShareRows(
  rows: readonly MassShareRow[],
  field: MassShareSortField,
  dir: "asc" | "desc",
  lang?: string,
): MassShareRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const stringKey = (r: MassShareRow): string | null =>
    field === "name" ? r.candidate.name : (r.teamNames[0] ?? null);
  const numericKey: ((r: MassShareRow) => number | null) | null =
    field === "status"
      ? (r) => STATUS_RANK[rowStatus(r)]
      : field === "overall"
        ? (r) => r.candidate.review?.overallRating ?? null
        : null;
  return [...rows].sort((a, b) => {
    const av = numericKey ? numericKey(a) : stringKey(a);
    const bv = numericKey ? numericKey(b) : stringKey(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
    return sign * String(av).localeCompare(String(bv), lang);
  });
}

/** "Select all matching": the current selection plus every SHAREABLE row of `filteredRows`. */
export function selectAllMatching(
  selected: ReadonlySet<number>,
  filteredRows: readonly MassShareRow[],
): Set<number> {
  const next = new Set(selected);
  for (const row of filteredRows) if (row.candidate.shareable) next.add(row.candidate.userId);
  return next;
}

/** The selection minus every row of `filteredRows` (the page's "deselect matching"). */
export function deselectMatching(
  selected: ReadonlySet<number>,
  filteredRows: readonly MassShareRow[],
): Set<number> {
  const next = new Set(selected);
  for (const row of filteredRows) next.delete(row.candidate.userId);
  return next;
}

/** The selected rows a submission would actually include (shareable, with a review id), in row order. */
export function submittableRows(
  rows: readonly MassShareRow[],
  selected: ReadonlySet<number>,
): MassShareRow[] {
  return rows.filter((row) => selected.has(row.candidate.userId) && shareableReviewId(row) != null);
}

/** The review ids to submit for the selected people, in row order; unshareable people never yield one. */
export function selectedReviewIds(
  rows: readonly MassShareRow[],
  selected: ReadonlySet<number>,
): number[] {
  return submittableRows(rows, selected).map((row) => shareableReviewId(row) as number);
}

/**
 * The selection after a run: people whose review was answered for every recipient (CREATED or
 * ALREADY_SHARED — nothing left to retry) leave it; anyone with a FORBIDDEN/NOT_FOUND item, or not
 * answered at all (a chunk the server rejected), stays for a retry.
 */
export function retainUnsettled(
  selected: ReadonlySet<number>,
  rows: readonly MassShareRow[],
  items: readonly ShareBatchItem[],
): Set<number> {
  const answered = new Set<number>();
  const failed = new Set<number>();
  for (const item of items) {
    answered.add(item.resourceId);
    if (item.status === "FORBIDDEN" || item.status === "NOT_FOUND") failed.add(item.resourceId);
  }
  const next = new Set(selected);
  for (const row of rows) {
    const id = shareableReviewId(row);
    if (id != null && answered.has(id) && !failed.has(id)) next.delete(row.candidate.userId);
  }
  return next;
}

export type BatchSummary = {
  /** CREATED pairs. */
  created: number;
  /** Per person whose review was already shared (the existing share kept, its end date included). */
  alreadyShared: { resourceId: number; person: string; sharees: string[] }[];
  /** Per person the server refused or no longer found. */
  failed: { resourceId: number; person: string; reason: "FORBIDDEN" | "NOT_FOUND" }[];
};

/** Groups a merged batch report into the result panel's lines (people by name, sharees in report order). */
export function summarizeBatchResult(
  items: readonly ShareBatchItem[],
  rows: readonly MassShareRow[],
  shareeNames: ReadonlyMap<number, string>,
): BatchSummary {
  const personOf = new Map<number, string>();
  for (const row of rows) {
    const id = shareableReviewId(row);
    if (id != null) personOf.set(id, row.candidate.name);
  }
  const person = (resourceId: number) => personOf.get(resourceId) ?? `#${resourceId}`;
  const already = new Map<number, string[]>();
  const failed: BatchSummary["failed"] = [];
  let created = 0;
  for (const item of items) {
    if (item.status === "CREATED") {
      created += 1;
    } else if (item.status === "ALREADY_SHARED") {
      const sharees = already.get(item.resourceId) ?? [];
      const shareeId = item.shareeId;
      sharees.push((shareeId != null ? shareeNames.get(shareeId) : undefined) ?? `#${shareeId}`);
      already.set(item.resourceId, sharees);
    } else {
      failed.push({ resourceId: item.resourceId, person: person(item.resourceId), reason: item.status });
    }
  }
  const byPerson = (a: { person: string }, b: { person: string }) => a.person.localeCompare(b.person);
  return {
    created,
    alreadyShared: [...already.entries()]
      .map(([resourceId, sharees]) => ({ resourceId, person: person(resourceId), sharees }))
      .sort(byPerson),
    failed: failed.sort(byPerson),
  };
}
