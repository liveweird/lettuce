// Teams API — CRUD, the member sub-resource, and the caller-relative members views.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { components, paths } from "./schema";

export type TeamPage = paths["/api/v1/teams"]["get"]["responses"]["200"]["content"]["application/json"];

type TeamListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  managerId?: number;
  /** Only with managerId (v2.26.0): widen to that manager's transitive subtree of teams. */
  includeIndirect?: boolean;
  memberId?: number;
  /** Strict ISO date (v4.17.0): the manager and roster as of that day, deleted teams included. */
  asOf?: string;
};

type CreateTeamBody =
  paths["/api/v1/teams"]["post"]["requestBody"]["content"]["application/json"];
type CreateTeamResponse =
  paths["/api/v1/teams"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createTeam(req: CreateTeamBody): Promise<CreateTeamResponse> {
  return jsonRequest<CreateTeamResponse>("/api/v1/teams", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function deleteTeam(id: number): Promise<void> {
  await voidRequest(`/api/v1/teams/${id}`, { method: "DELETE" });
}

export type TeamResponse =
  paths["/api/v1/teams/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateTeamBody =
  paths["/api/v1/teams/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getTeam(id: number): Promise<TeamResponse> {
  return jsonRequest<TeamResponse>(`/api/v1/teams/${id}`);
}

export async function updateTeam(id: number, body: UpdateTeamBody): Promise<void> {
  await voidRequest(`/api/v1/teams/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function listTeams(q: TeamListQuery): Promise<TeamPage> {
  const params = buildQuery({
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    name: q.name,
    managerId: q.managerId,
    includeIndirect: q.includeIndirect || undefined,
    memberId: q.memberId,
    asOf: q.asOf,
  });
  return jsonRequest<TeamPage>(`/api/v1/teams?${params}`);
}

export async function addTeamMember(teamId: number, userId: number): Promise<void> {
  await voidRequest(`/api/v1/teams/${teamId}/members/${userId}`, { method: "PUT" });
}

export async function removeTeamMember(teamId: number, userId: number): Promise<void> {
  await voidRequest(`/api/v1/teams/${teamId}/members/${userId}`, { method: "DELETE" });
}

export type TeamMemberPage =
  paths["/api/v1/teams/members"]["get"]["responses"]["200"]["content"]["application/json"];

export type TeamMemberListView = "member" | "managed" | "managers";

export type TeamMemberListQuery = {
  view: TeamMemberListView;
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  /** Members of any of these teams (repeated key, v4.13.0). */
  teamId?: number | number[];
  /** Only valid with view=managed: widen from direct reports to the whole management chain. */
  includeIndirect?: boolean;
  /** Strict-boolean account-status filter: true = only deactivated, false = only active,
   *  absent = both (`false` IS sent — buildQuery keeps it). */
  deactivated?: boolean;
};

export async function listTeamMembers(q: TeamMemberListQuery): Promise<TeamMemberPage> {
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    name: q.name,
    email: q.email,
    teamId: q.teamId,
    includeIndirect: q.includeIndirect || undefined,
    deactivated: q.deactivated,
  });
  return jsonRequest<TeamMemberPage>(`/api/v1/teams/members?${params}`);
}

/** Every team (optionally: of one member), paging until the server total is reached. */
export async function listAllTeams(
  filter: { memberId?: number; managerId?: number; includeIndirect?: boolean; asOf?: string } = {},
): Promise<TeamPage["items"]> {
  const items: TeamPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listTeams({ page, pageSize: 100, sort: "name", ...filter });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

/** Every row of one caller-relative view, paging until the server total is reached — the
 * listAllTeams idiom, for callers that need to find a specific person rather than a page.
 * `includeIndirect` widens the managed view to the transitive chain (the reviews dashboard);
 * `deactivated` narrows to inactive/active accounts (absent = both — the pickers and the
 * details/roster lookups want everyone). */
export async function listAllTeamMembers(
  view: TeamMemberListView,
  includeIndirect?: boolean,
  deactivated?: boolean,
): Promise<TeamMemberPage["items"]> {
  const items: TeamMemberPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listTeamMembers({ view, page, pageSize: 100, includeIndirect, deactivated });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

export type TeamRef = components["schemas"]["TeamRef"];

// --- Dated team structure (v4.17.0): membership periods and the manager succession line. ---

export type TeamMembership = components["schemas"]["TeamMembershipResponse"];
export type TeamMembershipCreateBody = components["schemas"]["TeamMembershipCreate"];
export type TeamMembershipBody = components["schemas"]["TeamMembershipWrite"];
export type TeamManagerPeriod = components["schemas"]["TeamManagerPeriodResponse"];
export type TeamManagerPeriodBody = components["schemas"]["TeamManagerPeriodWrite"];

export async function listTeamMemberships(teamId: number): Promise<TeamMembership[]> {
  const page = await jsonRequest<components["schemas"]["TeamMembershipList"]>(
    `/api/v1/teams/${teamId}/memberships`,
  );
  return page.items;
}

export async function createTeamMembership(
  teamId: number,
  body: TeamMembershipCreateBody,
): Promise<TeamMembership> {
  return jsonRequest<TeamMembership>(`/api/v1/teams/${teamId}/memberships`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTeamMembership(
  teamId: number,
  membershipId: number,
  body: TeamMembershipBody,
): Promise<void> {
  await voidRequest(`/api/v1/teams/${teamId}/memberships/${membershipId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteTeamMembership(teamId: number, membershipId: number): Promise<void> {
  await voidRequest(`/api/v1/teams/${teamId}/memberships/${membershipId}`, { method: "DELETE" });
}

export async function listTeamManagerPeriods(teamId: number): Promise<TeamManagerPeriod[]> {
  const page = await jsonRequest<components["schemas"]["TeamManagerPeriodList"]>(
    `/api/v1/teams/${teamId}/managers`,
  );
  return page.items;
}

export async function createTeamManagerPeriod(
  teamId: number,
  body: TeamManagerPeriodBody,
): Promise<TeamManagerPeriod> {
  return jsonRequest<TeamManagerPeriod>(`/api/v1/teams/${teamId}/managers`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTeamManagerPeriod(
  teamId: number,
  periodId: number,
  body: TeamManagerPeriodBody,
): Promise<void> {
  await voidRequest(`/api/v1/teams/${teamId}/managers/${periodId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteTeamManagerPeriod(teamId: number, periodId: number): Promise<void> {
  await voidRequest(`/api/v1/teams/${teamId}/managers/${periodId}`, { method: "DELETE" });
}
