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

type LoginBody = paths["/api/v1/login"]["post"]["requestBody"]["content"]["application/json"];
type LoginOk = paths["/api/v1/login"]["post"]["responses"]["200"]["content"]["application/json"];

export async function login(credentials: LoginBody): Promise<LoginOk> {
  const res = await fetch(`${API_BASE}/api/v1/login`, {
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
  await fetch(`${API_BASE}/api/v1/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  clearSession();
}

export type UserPage = paths["/api/v1/users"]["get"]["responses"]["200"]["content"]["application/json"];

export type UserListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  teamId?: number;
};

export type CurrentUser = paths["/api/v1/users/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

export async function getCurrentUser(): Promise<CurrentUser> {
  const id = getUserId();
  if (id === null) throw new ApiError(401, null);
  const res = await authedFetch(`/api/v1/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

export type CreateUserBody = paths["/api/v1/users"]["post"]["requestBody"]["content"]["application/json"];
export type CreateUserResponse = paths["/api/v1/users"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createUser(req: CreateUserBody): Promise<CreateUserResponse> {
  const res = await authedFetch("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateUserResponse;
}

export type UpdateUserBody =
  paths["/api/v1/users/{id}"]["patch"]["requestBody"]["content"]["application/json"];

export async function getUser(id: number): Promise<CurrentUser> {
  const res = await authedFetch(`/api/v1/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

export async function updateUser(id: number, body: UpdateUserBody): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type ChangePasswordBody =
  paths["/api/v1/users/{id}/password"]["put"]["requestBody"]["content"]["application/json"];

export async function changeUserPassword(id: number, body: ChangePasswordBody): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}/password`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteUser(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}`, { method: "DELETE" });
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
  const res = await authedFetch(`/api/v1/users?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as UserPage;
}

export type TeamPage = paths["/api/v1/teams"]["get"]["responses"]["200"]["content"]["application/json"];

export type TeamListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  managerId?: number;
  memberId?: number;
};

export type CreateTeamBody =
  paths["/api/v1/teams"]["post"]["requestBody"]["content"]["application/json"];
export type CreateTeamResponse =
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
export type UpdateTeamBody =
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
  const res = await authedFetch(`/api/v1/teams/members?${params.toString()}`);
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
  paths["/api/v1/feedbacks"]["get"]["responses"]["200"]["content"]["application/json"];

export type FeedbackVisibility =
  | "PROVIDER_SUBJECT"
  | "PROVIDER_REQUESTER"
  | "PROVIDER_REQUESTER_SUBJECT"
  | "PUBLIC";
export type FeedbackStatus = "REQUESTED" | "DRAFT" | "SENT" | "WITHDRAWN" | "REJECTED";

export type FeedbackListView = "received" | "provided" | "team";

export type FeedbackListQuery = {
  view: FeedbackListView;
  page: number;
  pageSize: number;
  sort?: string;
  requesterName?: string;
  subjectName?: string;
  providerName?: string;
  providerId?: number;
  subjectId?: number;
  visibility?: FeedbackVisibility;
  status?: FeedbackStatus;
  lastModifiedGte?: number;
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
  if (q.providerId != null) params.set("providerId", String(q.providerId));
  if (q.subjectId != null) params.set("subjectId", String(q.subjectId));
  if (q.visibility) params.set("visibility", q.visibility);
  if (q.status) params.set("status", q.status);
  if (q.lastModifiedGte != null) params.set("lastModified[gte]", String(q.lastModifiedGte));
  const res = await authedFetch(`/api/v1/feedbacks?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as FeedbackPage;
}

export type CreateFeedbackBody =
  paths["/api/v1/feedbacks"]["post"]["requestBody"]["content"]["application/json"];
export type CreateFeedbackResponse =
  paths["/api/v1/feedbacks"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createFeedback(req: CreateFeedbackBody): Promise<CreateFeedbackResponse> {
  const res = await authedFetch("/api/v1/feedbacks", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateFeedbackResponse;
}

export type FeedbackResponse =
  paths["/api/v1/feedbacks/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type UpdateFeedbackBody =
  paths["/api/v1/feedbacks/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getFeedback(id: number): Promise<FeedbackResponse> {
  const res = await authedFetch(`/api/v1/feedbacks/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as FeedbackResponse;
}

export async function updateFeedback(id: number, body: UpdateFeedbackBody): Promise<void> {
  const res = await authedFetch(`/api/v1/feedbacks/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteFeedback(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/feedbacks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type FeedbackEventList =
  paths["/api/v1/feedbacks/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type FeedbackEvent = FeedbackEventList["items"][number];

export async function listFeedbackEvents(id: number): Promise<FeedbackEvent[]> {
  const res = await authedFetch(`/api/v1/feedbacks/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json() as FeedbackEventList).items;
}

export type TemplatePage =
  paths["/api/v1/templates"]["get"]["responses"]["200"]["content"]["application/json"];

export type TemplateListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
};

export async function listTemplates(q: TemplateListQuery): Promise<TemplatePage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.name) params.set("name", q.name);
  const res = await authedFetch(`/api/v1/templates?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TemplatePage;
}

export type CreateTemplateBody =
  paths["/api/v1/templates"]["post"]["requestBody"]["content"]["application/json"];
export type CreateTemplateResponse =
  paths["/api/v1/templates"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createTemplate(req: CreateTemplateBody): Promise<CreateTemplateResponse> {
  const res = await authedFetch("/api/v1/templates", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateTemplateResponse;
}

export type TemplateResponse =
  paths["/api/v1/templates/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type UpdateTemplateBody =
  paths["/api/v1/templates/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getTemplate(id: number): Promise<TemplateResponse> {
  const res = await authedFetch(`/api/v1/templates/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TemplateResponse;
}

export async function updateTemplate(id: number, body: UpdateTemplateBody): Promise<void> {
  const res = await authedFetch(`/api/v1/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/templates/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type NotificationPage =
  paths["/api/v1/notifications"]["get"]["responses"]["200"]["content"]["application/json"];
export type NotificationItem = NotificationPage["items"][number];

export type NotificationListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  wasSeen?: boolean;
};

export async function listNotifications(q: NotificationListQuery): Promise<NotificationPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.wasSeen != null) params.set("wasSeen", String(q.wasSeen));
  const res = await authedFetch(`/api/v1/notifications?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as NotificationPage;
}

export async function markNotificationSeen(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/${id}/seen`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function markNotificationUnseen(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/${id}/unseen`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function markAllNotificationsSeen(): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/seen-all`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
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
