// Teams API — CRUD, the member sub-resource, and the caller-relative members views.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { components, paths } from "./schema";

export type TeamPage = paths["/api/v1/teams"]["get"]["responses"]["200"]["content"]["application/json"];

type TeamListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  managerId?: number;
  memberId?: number;
};

type CreateTeamBody =
  paths["/api/v1/teams"]["post"]["requestBody"]["content"]["application/json"];
type CreateTeamResponse =
  paths["/api/v1/teams"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createTeam(req: CreateTeamBody): Promise<CreateTeamResponse> {
  const res = await authedFetch("/api/v1/teams", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateTeamResponse;
}

export async function deleteTeam(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/teams/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type TeamResponse =
  paths["/api/v1/teams/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateTeamBody =
  paths["/api/v1/teams/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getTeam(id: number): Promise<TeamResponse> {
  const res = await authedFetch(`/api/v1/teams/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamResponse;
}

export async function updateTeam(id: number, body: UpdateTeamBody): Promise<void> {
  const res = await authedFetch(`/api/v1/teams/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function listTeams(q: TeamListQuery): Promise<TeamPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.name) params.set("name", q.name);
  if (q.managerId != null) params.set("managerId", String(q.managerId));
  if (q.memberId != null) params.set("memberId", String(q.memberId));
  const res = await authedFetch(`/api/v1/teams?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamPage;
}

export async function addTeamMember(teamId: number, userId: number): Promise<void> {
  const res = await authedFetch(`/api/v1/teams/${teamId}/members/${userId}`, { method: "PUT" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function removeTeamMember(teamId: number, userId: number): Promise<void> {
  const res = await authedFetch(`/api/v1/teams/${teamId}/members/${userId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type TeamMemberPage =
  paths["/api/v1/teams/members"]["get"]["responses"]["200"]["content"]["application/json"];

export type TeamMemberListView = "member" | "managed" | "managers";

type TeamMemberListQuery = {
  view: TeamMemberListView;
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  teamId?: number;
  /** Only valid with view=managed: widen from direct reports to the whole management chain. */
  includeIndirect?: boolean;
};

export async function listTeamMembers(q: TeamMemberListQuery): Promise<TeamMemberPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.name) params.set("name", q.name);
  if (q.email) params.set("email", q.email);
  if (q.teamId != null) params.set("teamId", String(q.teamId));
  if (q.includeIndirect) params.set("includeIndirect", "true");
  const res = await authedFetch(`/api/v1/teams/members?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamMemberPage;
}

/** Every team (optionally: of one member), paging until the server total is reached. */
export async function listAllTeams(filter: { memberId?: number } = {}): Promise<TeamPage["items"]> {
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
 * `includeIndirect` widens the managed view to the transitive chain (the reviews dashboard). */
export async function listAllTeamMembers(
  view: TeamMemberListView,
  includeIndirect?: boolean,
): Promise<TeamMemberPage["items"]> {
  const items: TeamMemberPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listTeamMembers({ view, page, pageSize: 100, includeIndirect });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

export type TeamRef = components["schemas"]["TeamRef"];
