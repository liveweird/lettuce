// Review periods & performance reviews API.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

export type ReviewPeriod =
  paths["/api/v1/review-periods"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type ReviewPeriodCreateBody =
  paths["/api/v1/review-periods"]["post"]["requestBody"]["content"]["application/json"];

/** The whole global timeline, oldest first — unpaged (the registry is intrinsically small). */
export async function listReviewPeriods(): Promise<ReviewPeriod[]> {
  const res = await authedFetch("/api/v1/review-periods");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: ReviewPeriod[] }).items;
}

// ADMIN-only; the timeline is append-only — a start not adjacent to the latest end is 409.
export async function createReviewPeriod(body: ReviewPeriodCreateBody): Promise<ReviewPeriod> {
  const res = await authedFetch("/api/v1/review-periods", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as ReviewPeriod;
}

// ADMIN-only; only the latest, review-free period deletes (else 409).
export async function deleteReviewPeriod(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/review-periods/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type PerformanceReviewPage =
  paths["/api/v1/performance-reviews"]["get"]["responses"]["200"]["content"]["application/json"];
export type PerformanceReviewListItem = PerformanceReviewPage["items"][number];
export type PerformanceReviewResponse =
  paths["/api/v1/performance-reviews/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type PerformanceReviewStatus = PerformanceReviewResponse["status"];
export type CategoryAssessment = PerformanceReviewResponse["attitude"];

export type PerformanceReviewListView = "own" | "managed" | "team" | "user";

type PerformanceReviewListQuery = {
  view: PerformanceReviewListView;
  page: number;
  pageSize: number;
  sort?: string;
  managerName?: string;
  subordinateName?: string;
  status?: PerformanceReviewStatus;
  managerId?: number;
  subordinateId?: number;
  /** Exact period match — the per-period dashboard/table filter. */
  periodId?: number;
  createdAtGte?: number;
  /** Only valid with view=managed/team: widen from the caller's own to the whole chain. */
  includeIndirect?: boolean;
  /** Required with view=user (the HR auditor view): whose records to list. */
  userId?: number;
};

export async function listPerformanceReviews(
  q: PerformanceReviewListQuery,
): Promise<PerformanceReviewPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.managerName) params.set("managerName", q.managerName);
  if (q.subordinateName) params.set("subordinateName", q.subordinateName);
  if (q.status) params.set("status", q.status);
  if (q.managerId != null) params.set("managerId", String(q.managerId));
  if (q.subordinateId != null) params.set("subordinateId", String(q.subordinateId));
  if (q.periodId != null) params.set("periodId", String(q.periodId));
  if (q.createdAtGte != null) params.set("createdAt[gte]", String(q.createdAtGte));
  if (q.includeIndirect) params.set("includeIndirect", "true");
  if (q.userId != null) params.set("userId", String(q.userId));
  const res = await authedFetch(`/api/v1/performance-reviews?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PerformanceReviewPage;
}

/** Every review of one scope, paging until the server total is reached — the reviews-dashboard
 * client-side join fetches a whole period this way (org-bounded, like the card grids). */
export async function listAllPerformanceReviews(
  q: Omit<PerformanceReviewListQuery, "page" | "pageSize">,
): Promise<PerformanceReviewPage["items"]> {
  const items: PerformanceReviewPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listPerformanceReviews({ ...q, page, pageSize: 100 });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

export type PerformanceReviewCreateBody =
  paths["/api/v1/performance-reviews"]["post"]["requestBody"]["content"]["application/json"];
export type PerformanceReviewUpdateBody =
  paths["/api/v1/performance-reviews/{id}"]["put"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT (assessments may be partial); the caller is the manager and the
// subordinate must be a direct report. An occupied (subordinate, period) slot is 409 whose
// ProblemDetail.instance points at the existing review.
export async function createPerformanceReview(
  body: PerformanceReviewCreateBody,
): Promise<PerformanceReviewResponse> {
  const res = await authedFetch("/api/v1/performance-reviews", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PerformanceReviewResponse;
}

export async function getPerformanceReview(id: number): Promise<PerformanceReviewResponse> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PerformanceReviewResponse;
}

// Full replace of the eight assessment values; DRAFT/CALIBRATION only (PUBLISHED is 409), and
// in CALIBRATION the payload must stay complete (400).
export async function updatePerformanceReview(
  id: number,
  body: PerformanceReviewUpdateBody,
): Promise<void> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deletePerformanceReview(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// Lifecycle transitions are POST action sub-resources; each names one edge of the
// DRAFT <-> CALIBRATION <-> PUBLISHED machine, so a review not at the edge's source status
// returns 409 (and an incomplete draft's submit is 400).
async function reviewTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const submitPerformanceReview = (id: number) => reviewTransition(id, "submit");
export const revertPerformanceReview = (id: number) => reviewTransition(id, "revert");
export const publishPerformanceReview = (id: number) => reviewTransition(id, "publish");
export const unpublishPerformanceReview = (id: number) => reviewTransition(id, "unpublish");

type PerformanceReviewEventList =
  paths["/api/v1/performance-reviews/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type PerformanceReviewEvent = PerformanceReviewEventList["items"][number];

export async function listPerformanceReviewEvents(id: number): Promise<PerformanceReviewEvent[]> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as PerformanceReviewEventList).items;
}
