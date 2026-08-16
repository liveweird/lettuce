// Career positions & the caller-relative team pyramid.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { components, paths } from "./schema";

export type CareerPosition = components["schemas"]["CareerPositionResponse"];
export type CareerPositionWriteBody = components["schemas"]["CareerPositionWrite"];
type CareerPositionListResponse =
  paths["/api/v1/users/{id}/career-positions"]["get"]["responses"]["200"]["content"]["application/json"];

/** The user's career timeline, chronological (unpaged) — the last item is the current position. */
export async function listCareerPositions(userId: number): Promise<CareerPosition[]> {
  const res = await authedFetch(`/api/v1/users/${userId}/career-positions`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as CareerPositionListResponse).items;
}

export type CareerPyramidItem = components["schemas"]["CareerPyramidItem"];
export type CareerPyramidPosition = components["schemas"]["CareerPyramidPosition"];
export type CareerPyramidList =
  paths["/api/v1/career/pyramid"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * The caller's team pyramid (v2.16.0): one entry per subordinate — direct reports, or the
 * whole transitive chain — with the FULL position history plus the org-wide earliest start
 * date (v2.17.0, the time slider's lower bound). Unpaged (bounded by the subordinate
 * count); name-sorted.
 */
export async function listCareerPyramid(includeIndirect: boolean): Promise<CareerPyramidList> {
  const params = new URLSearchParams();
  if (includeIndirect) params.set("includeIndirect", "true");
  const query = params.toString();
  const res = await authedFetch(`/api/v1/career/pyramid${query ? `?${query}` : ""}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CareerPyramidList;
}

/** Start a new position (chain managers only) — implicitly concludes the current one. */
export async function createCareerPosition(
  userId: number,
  body: CareerPositionWriteBody,
): Promise<CareerPosition> {
  const res = await authedFetch(`/api/v1/users/${userId}/career-positions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CareerPosition;
}

/** Correct a position in place (chain managers only). */
export async function updateCareerPosition(
  userId: number,
  positionId: number,
  body: CareerPositionWriteBody,
): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${userId}/career-positions/${positionId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

/** Remove a position (chain managers only) — the previous one absorbs the span. */
export async function deleteCareerPosition(userId: number, positionId: number): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${userId}/career-positions/${positionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
