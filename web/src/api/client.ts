import type { paths } from "./schema";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

export type UserRole = "ADMIN" | "USER";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export function getRole(): UserRole | null {
  const raw = localStorage.getItem(ROLE_KEY);
  return raw === "ADMIN" || raw === "USER" ? raw : null;
}

export function getUserId(): number | null {
  const raw = localStorage.getItem(USER_ID_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAdmin(): boolean {
  return getRole() === "ADMIN";
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

type LoginBody = paths["/api/login"]["post"]["requestBody"]["content"]["application/json"];
type LoginOk = paths["/api/login"]["post"]["responses"]["200"]["content"]["application/json"];

export async function login(credentials: LoginBody): Promise<LoginOk> {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  const data = (await res.json()) as LoginOk;
  setToken(data.token);
  localStorage.setItem(ROLE_KEY, data.role);
  localStorage.setItem(USER_ID_KEY, String(data.userId));
  return data;
}

export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  await fetch(`${API_BASE}/api/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  clearSession();
}

export type UserPage = paths["/api/users"]["get"]["responses"]["200"]["content"]["application/json"];

export type UserListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  teamId?: number;
};

export type CurrentUser = paths["/api/users/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

export async function getCurrentUser(): Promise<CurrentUser> {
  const id = getUserId();
  if (id === null) throw new ApiError(401, null);
  const res = await authedFetch(`/api/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

export type CreateUserBody = paths["/api/users"]["post"]["requestBody"]["content"]["application/json"];
export type CreateUserResponse = paths["/api/users"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createUser(req: CreateUserBody): Promise<CreateUserResponse> {
  const res = await authedFetch("/api/users", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateUserResponse;
}

export type UpdateUserBody =
  paths["/api/users/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getUser(id: number): Promise<CurrentUser> {
  const res = await authedFetch(`/api/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

export async function updateUser(id: number, body: UpdateUserBody): Promise<void> {
  const res = await authedFetch(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type ChangePasswordBody =
  paths["/api/users/{id}/password"]["put"]["requestBody"]["content"]["application/json"];

export async function changeUserPassword(id: number, body: ChangePasswordBody): Promise<void> {
  const res = await authedFetch(`/api/users/${id}/password`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteUser(id: number): Promise<void> {
  const res = await authedFetch(`/api/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function listUsers(q: UserListQuery): Promise<UserPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.name) params.set("name", q.name);
  if (q.email) params.set("email", q.email);
  if (q.role) params.set("role", q.role);
  if (q.teamId != null) params.set("teamId", String(q.teamId));
  const res = await authedFetch(`/api/users?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as UserPage;
}

export type TeamPage = paths["/api/teams"]["get"]["responses"]["200"]["content"]["application/json"];

export type TeamListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  managerId?: number;
  memberId?: number;
};

export type CreateTeamBody =
  paths["/api/teams"]["post"]["requestBody"]["content"]["application/json"];
export type CreateTeamResponse =
  paths["/api/teams"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createTeam(req: CreateTeamBody): Promise<CreateTeamResponse> {
  const res = await authedFetch("/api/teams", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateTeamResponse;
}

export async function deleteTeam(id: number): Promise<void> {
  const res = await authedFetch(`/api/teams/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type TeamResponse =
  paths["/api/teams/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type UpdateTeamBody =
  paths["/api/teams/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getTeam(id: number): Promise<TeamResponse> {
  const res = await authedFetch(`/api/teams/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamResponse;
}

export async function updateTeam(id: number, body: UpdateTeamBody): Promise<void> {
  const res = await authedFetch(`/api/teams/${id}`, {
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
  const res = await authedFetch(`/api/teams?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamPage;
}

export async function addTeamMember(teamId: number, userId: number): Promise<void> {
  const res = await authedFetch(`/api/teams/${teamId}/members/${userId}`, { method: "PUT" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function removeTeamMember(teamId: number, userId: number): Promise<void> {
  const res = await authedFetch(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type TeamMemberPage =
  paths["/api/teams/members"]["get"]["responses"]["200"]["content"]["application/json"];

export type TeamMemberListView = "member" | "managed" | "managers";

export type TeamMemberListQuery = {
  view: TeamMemberListView;
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  teamId?: number;
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
  const res = await authedFetch(`/api/teams/members?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamMemberPage;
}

export async function listAllTeams(): Promise<TeamPage["items"]> {
  const items: TeamPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listTeams({ page, pageSize: 100, sort: "name" });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

export type FeedbackPage =
  paths["/api/feedbacks"]["get"]["responses"]["200"]["content"]["application/json"];

export type FeedbackVisibility =
  | "PROVIDER_SUBJECT"
  | "PROVIDER_REQUESTER"
  | "PROVIDER_REQUESTER_SUBJECT"
  | "PUBLIC";
export type FeedbackStatus = "REQUESTED" | "DRAFT" | "SENT" | "WITHDRAWN";

export type FeedbackListView = "received" | "provided";

export type FeedbackListQuery = {
  view: FeedbackListView;
  page: number;
  pageSize: number;
  sort?: string;
  requesterName?: string;
  subjectName?: string;
  providerName?: string;
  visibility?: FeedbackVisibility;
  status?: FeedbackStatus;
};

export async function listFeedbacks(q: FeedbackListQuery): Promise<FeedbackPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.requesterName) params.set("requesterName", q.requesterName);
  if (q.subjectName) params.set("subjectName", q.subjectName);
  if (q.providerName) params.set("providerName", q.providerName);
  if (q.visibility) params.set("visibility", q.visibility);
  if (q.status) params.set("status", q.status);
  const res = await authedFetch(`/api/feedbacks?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as FeedbackPage;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) clearSession();
  return res;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
