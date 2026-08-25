// Team KPIs API — CRUD, the data-point series, transitions, and the event history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

export type TeamKpiPage =
  paths["/api/v1/team-kpis"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiResponse =
  paths["/api/v1/team-kpis/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiStatus = TeamKpiResponse["status"];
export type TeamKpiType = TeamKpiResponse["type"];
// Re-exported from the KPI response so KPI code needs no cross-module type import; the same
// two-value union as the goals TargetDirection.
export type TargetDirection = TeamKpiResponse["targetDirection"];

export type TeamKpiListView = "own" | "managed";

type TeamKpiListQuery = {
  view: TeamKpiListView;
  page: number;
  pageSize: number;
  sort?: string;
  title?: string;
  teamName?: string;
  status?: TeamKpiStatus;
  type?: TeamKpiType;
  /** Exact team match — the per-team drill-down. */
  teamId?: number;
  createdAtGte?: number;
  /** view=managed only (v2.26.0): widen to the caller's transitive management subtree. */
  includeIndirect?: boolean;
};

export async function listTeamKpis(q: TeamKpiListQuery): Promise<TeamKpiPage> {
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    title: q.title,
    teamName: q.teamName,
    status: q.status,
    type: q.type,
    teamId: q.teamId,
    "createdAt[gte]": q.createdAtGte,
    includeIndirect: q.includeIndirect || undefined,
  });
  return jsonRequest<TeamKpiPage>(`/api/v1/team-kpis?${params}`);
}

export type TeamKpiCreateBody =
  paths["/api/v1/team-kpis"]["post"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT; the caller must manage the team directly or from the chain above
// (v2.26.0) and is stamped as the KPI's creator (informational).
export async function createTeamKpi(body: TeamKpiCreateBody): Promise<TeamKpiResponse> {
  return jsonRequest<TeamKpiResponse>("/api/v1/team-kpis", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type TeamKpiDefinitionUpdateBody =
  paths["/api/v1/team-kpis/{id}"]["put"]["requestBody"]["content"]["application/json"];
type TeamKpiValueList =
  paths["/api/v1/team-kpis/{id}/values"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiValue = TeamKpiValueList["items"][number];
export type TeamKpiValueWriteBody =
  paths["/api/v1/team-kpis/{id}/values"]["post"]["requestBody"]["content"]["application/json"];
type TeamKpiArchiveBody =
  paths["/api/v1/team-kpis/{id}/archive"]["post"]["requestBody"]["content"]["application/json"];

export async function getTeamKpi(id: number): Promise<TeamKpiResponse> {
  return jsonRequest<TeamKpiResponse>(`/api/v1/team-kpis/${id}`);
}

export async function updateTeamKpiDefinition(
  id: number,
  body: TeamKpiDefinitionUpdateBody,
): Promise<void> {
  await voidRequest(`/api/v1/team-kpis/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// The KPI's collected data points, sorted by date newest first (the KPI-data tab and the
// graph both feed on this list).
export async function listTeamKpiValues(id: number): Promise<TeamKpiValue[]> {
  return (await jsonRequest<TeamKpiValueList>(`/api/v1/team-kpis/${id}/values`)).items;
}

// Data points are only mutable while the KPI is ACTIVE (409 otherwise) and by whoever the
// server granted canRecordValues — the team's manager, their chain, or a team member
// (v2.26.0); a duplicate date is also 409 — at most one value per date.
export async function addTeamKpiValue(id: number, body: TeamKpiValueWriteBody): Promise<TeamKpiValue> {
  return jsonRequest<TeamKpiValue>(`/api/v1/team-kpis/${id}/values`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTeamKpiValue(
  id: number,
  valueId: number,
  body: TeamKpiValueWriteBody,
): Promise<void> {
  await voidRequest(`/api/v1/team-kpis/${id}/values/${valueId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteTeamKpiValue(id: number, valueId: number): Promise<void> {
  await voidRequest(`/api/v1/team-kpis/${id}/values/${valueId}`, { method: "DELETE" });
}

export async function deleteTeamKpi(id: number): Promise<void> {
  await voidRequest(`/api/v1/team-kpis/${id}`, { method: "DELETE" });
}

// Lifecycle transitions are POST action sub-resources; each names one edge of the
// DRAFT <-> ACTIVE <-> ARCHIVED machine, so a KPI not at the edge's source status returns 409.
async function teamKpiTransition(id: number, action: string): Promise<void> {
  await voidRequest(`/api/v1/team-kpis/${id}/${action}`, { method: "POST" });
}

export const activateTeamKpi = (id: number) => teamKpiTransition(id, "activate");
export const deactivateTeamKpi = (id: number) => teamKpiTransition(id, "deactivate");
export const reopenTeamKpi = (id: number) => teamKpiTransition(id, "reopen");

// Archive is the one bodied transition — it always records the summary.
export async function archiveTeamKpi(id: number, body: TeamKpiArchiveBody): Promise<void> {
  await voidRequest(`/api/v1/team-kpis/${id}/archive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

type TeamKpiEventList =
  paths["/api/v1/team-kpis/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiEvent = TeamKpiEventList["items"][number];

export async function listTeamKpiEvents(id: number): Promise<TeamKpiEvent[]> {
  return (await jsonRequest<TeamKpiEventList>(`/api/v1/team-kpis/${id}/events`)).items;
}
