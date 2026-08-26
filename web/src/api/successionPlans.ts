// Succession plans API — the manager's critical-role/seat records with their successor
// nominations and linked development goals. Thin endpoint wrappers: transport
// (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

export type SuccessionPlanPage =
  paths["/api/v1/succession-plans"]["get"]["responses"]["200"]["content"]["application/json"];
export type SuccessionPlanListItem = SuccessionPlanPage["items"][number];
export type SuccessionPlanResponse =
  paths["/api/v1/succession-plans/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type SuccessionPlanCreateBody =
  paths["/api/v1/succession-plans"]["post"]["requestBody"]["content"]["application/json"];
export type SuccessionPlanUpdateBody =
  paths["/api/v1/succession-plans/{id}"]["put"]["requestBody"]["content"]["application/json"];
export type SuccessionNominationBody =
  paths["/api/v1/succession-plans/{id}/nominations"]["post"]["requestBody"]["content"]["application/json"];
export type SuccessionNominationResponse =
  paths["/api/v1/succession-plans/{id}/nominations"]["post"]["responses"]["201"]["content"]["application/json"];

export type RoleCriticality = SuccessionPlanResponse["roleCriticality"];
export type RetentionRisk = SuccessionPlanResponse["retentionRisk"];
export type SuccessionPlanStatus = SuccessionPlanResponse["status"];
export type SuccessorReadiness = SuccessionNominationResponse["readiness"];
export type NominationType = SuccessionNominationResponse["nominationType"];
export type CandidateAwareness = SuccessionNominationResponse["awareness"];

export type SuccessionListView = "own" | "team" | "user";

type SuccessionListQuery = {
  view: SuccessionListView;
  page: number;
  pageSize: number;
  sort?: string;
  userName?: string;
  status?: SuccessionPlanStatus;
  /** Only valid with view=team: widen from direct report managers to the whole chain. */
  includeIndirect?: boolean;
  /** Required with view=user (the HR auditor view): whose plans to list; rejected elsewhere. */
  userId?: number;
};

export async function listSuccessionPlans(q: SuccessionListQuery): Promise<SuccessionPlanPage> {
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    userName: q.userName,
    status: q.status,
    includeIndirect: q.includeIndirect || undefined,
    userId: q.userId,
  });
  return jsonRequest<SuccessionPlanPage>(`/api/v1/succession-plans?${params}`);
}

// The owner is always the caller — the body names only the seat's person.
export async function createSuccessionPlan(
  body: SuccessionPlanCreateBody,
): Promise<SuccessionPlanResponse> {
  return jsonRequest<SuccessionPlanResponse>("/api/v1/succession-plans", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSuccessionPlan(id: number): Promise<SuccessionPlanResponse> {
  return jsonRequest<SuccessionPlanResponse>(`/api/v1/succession-plans/${id}`);
}

export async function updateSuccessionPlan(
  id: number,
  body: SuccessionPlanUpdateBody,
): Promise<void> {
  await voidRequest(`/api/v1/succession-plans/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** OPEN → CLOSED, terminal (no reopen; delete stays available). */
export async function closeSuccessionPlan(id: number): Promise<void> {
  await voidRequest(`/api/v1/succession-plans/${id}/close`, { method: "POST" });
}

/**
 * Stamps the plan's reviewed date — THE only writer of it besides creation (v2.44.0).
 * Owner-only, OPEN plans only, repeatable.
 */
export async function completeSuccessionReview(id: number): Promise<void> {
  await voidRequest(`/api/v1/succession-plans/${id}/complete-review`, { method: "POST" });
}

export async function deleteSuccessionPlan(id: number): Promise<void> {
  await voidRequest(`/api/v1/succession-plans/${id}`, { method: "DELETE" });
}

export async function createSuccessionNomination(
  planId: number,
  body: SuccessionNominationBody,
): Promise<SuccessionNominationResponse> {
  return jsonRequest<SuccessionNominationResponse>(`/api/v1/succession-plans/${planId}/nominations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSuccessionNomination(
  planId: number,
  nominationId: number,
  body: SuccessionNominationBody,
): Promise<void> {
  await voidRequest(`/api/v1/succession-plans/${planId}/nominations/${nominationId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteSuccessionNomination(
  planId: number,
  nominationId: number,
): Promise<void> {
  await voidRequest(`/api/v1/succession-plans/${planId}/nominations/${nominationId}`, {
    method: "DELETE",
  });
}

/**
 * ALL of the caller's own OPEN plans (the listAllTeamMembers paging-loop shape) — the pool
 * behind the person-card "Succession plan" button (v2.47.0). `view=own` implies ownership;
 * OPEN-only keeps the (person → plan) mapping unique (the V68 one-OPEN-per-pair invariant).
 */
export async function listAllOwnOpenSuccessionPlans(): Promise<SuccessionPlanListItem[]> {
  const items: SuccessionPlanListItem[] = [];
  let page = 1;
  for (;;) {
    const result = await listSuccessionPlans({ view: "own", status: "OPEN", page, pageSize: 100 });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

type SuccessionPlanEventList =
  paths["/api/v1/succession-plans/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type SuccessionPlanEvent = SuccessionPlanEventList["items"][number];

export async function listSuccessionPlanEvents(id: number): Promise<SuccessionPlanEvent[]> {
  return (await jsonRequest<SuccessionPlanEventList>(`/api/v1/succession-plans/${id}/events`)).items;
}
