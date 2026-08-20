// Team KPIs API — CRUD, the data-point series, transitions, and the event history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

export type TeamKpiPage =
  paths["/api/v1/team-kpis"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiResponse =
  paths["/api/v1/team-kpis/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiStatus = TeamKpiResponse["status"];
export type TeamKpiType = TeamKpiResponse["type"];

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
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.title) params.set("title", q.title);
  if (q.teamName) params.set("teamName", q.teamName);
  if (q.status) params.set("status", q.status);
  if (q.type) params.set("type", q.type);
  if (q.teamId != null) params.set("teamId", String(q.teamId));
  if (q.createdAtGte != null) params.set("createdAt[gte]", String(q.createdAtGte));
  if (q.includeIndirect) params.set("includeIndirect", "true");
  const res = await authedFetch(`/api/v1/team-kpis?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamKpiPage;
}

export type TeamKpiCreateBody =
  paths["/api/v1/team-kpis"]["post"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT; the caller must manage the team directly or from the chain above
// (v2.26.0) and is stamped as the KPI's creator (informational).
export async function createTeamKpi(body: TeamKpiCreateBody): Promise<TeamKpiResponse> {
  const res = await authedFetch("/api/v1/team-kpis", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamKpiResponse;
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
  const res = await authedFetch(`/api/v1/team-kpis/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamKpiResponse;
}

export async function updateTeamKpiDefinition(
  id: number,
  body: TeamKpiDefinitionUpdateBody,
): Promise<void> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// The KPI's collected data points, sorted by date newest first (the KPI-data tab and the
// graph both feed on this list).
export async function listTeamKpiValues(id: number): Promise<TeamKpiValue[]> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/values`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as TeamKpiValueList).items;
}

// Data points are only mutable while the KPI is ACTIVE (409 otherwise) and by whoever the
// server granted canRecordValues — the team's manager, their chain, or a team member
// (v2.26.0); a duplicate date is also 409 — at most one value per date.
export async function addTeamKpiValue(id: number, body: TeamKpiValueWriteBody): Promise<TeamKpiValue> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/values`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamKpiValue;
}

export async function updateTeamKpiValue(
  id: number,
  valueId: number,
  body: TeamKpiValueWriteBody,
): Promise<void> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/values/${valueId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteTeamKpiValue(id: number, valueId: number): Promise<void> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/values/${valueId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteTeamKpi(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// Lifecycle transitions are POST action sub-resources; each names one edge of the
// DRAFT <-> ACTIVE <-> ARCHIVED machine, so a KPI not at the edge's source status returns 409.
async function teamKpiTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const activateTeamKpi = (id: number) => teamKpiTransition(id, "activate");
export const deactivateTeamKpi = (id: number) => teamKpiTransition(id, "deactivate");
export const reopenTeamKpi = (id: number) => teamKpiTransition(id, "reopen");

// Archive is the one bodied transition — it always records the summary.
export async function archiveTeamKpi(id: number, body: TeamKpiArchiveBody): Promise<void> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/archive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

type TeamKpiEventList =
  paths["/api/v1/team-kpis/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiEvent = TeamKpiEventList["items"][number];

export async function listTeamKpiEvents(id: number): Promise<TeamKpiEvent[]> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as TeamKpiEventList).items;
}
