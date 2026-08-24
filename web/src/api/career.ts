// Career positions & the caller-relative team pyramid.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { components, paths } from "./schema";

export type CareerPosition = components["schemas"]["CareerPositionResponse"];
export type CareerPositionWriteBody = components["schemas"]["CareerPositionWrite"];
export type CareerPositionListResponse =
  paths["/api/v1/users/{id}/career-positions"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * The user's career timeline, chronological (unpaged) — the last item is the current
 * position — plus the envelope's `canEdit` capability (v2.34.0: the caller is a chain
 * manager, the editor's server-computed gate).
 */
export async function listCareerPositions(userId: number): Promise<CareerPositionListResponse> {
  return jsonRequest<CareerPositionListResponse>(`/api/v1/users/${userId}/career-positions`);
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
  const query = buildQuery({ includeIndirect: includeIndirect || undefined });
  return jsonRequest<CareerPyramidList>(`/api/v1/career/pyramid${query ? `?${query}` : ""}`);
}

/**
 * Record a position (chain managers only) at any non-future start date: an append implicitly
 * concludes the current one; a past date backfills history (v2.39.0) — the timeline
 * re-derives the neighboring ends around it.
 */
export async function createCareerPosition(
  userId: number,
  body: CareerPositionWriteBody,
): Promise<CareerPosition> {
  return jsonRequest<CareerPosition>(`/api/v1/users/${userId}/career-positions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Correct a position in place (chain managers only). */
export async function updateCareerPosition(
  userId: number,
  positionId: number,
  body: CareerPositionWriteBody,
): Promise<void> {
  await voidRequest(`/api/v1/users/${userId}/career-positions/${positionId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Remove a position (chain managers only) — the previous one absorbs the span. */
export async function deleteCareerPosition(userId: number, positionId: number): Promise<void> {
  await voidRequest(`/api/v1/users/${userId}/career-positions/${positionId}`, {
    method: "DELETE",
  });
}
