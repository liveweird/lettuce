import type { paths } from "./schema";
import { flagSignedOut, notifyAuthChange } from "../auth";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const TOKEN_KEY = "lettuce.auth.token";
const REFRESH_TOKEN_KEY = "lettuce.auth.refreshToken";
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

function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setRefreshToken(token: string | null): void {
  if (token === null) localStorage.removeItem(REFRESH_TOKEN_KEY);
  else localStorage.setItem(REFRESH_TOKEN_KEY, token);
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
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

// Persist the access + refresh pair (and the current role/userId) returned by /login or /refresh.
function persistSession(data: LoginOk): void {
  setToken(data.token);
  setRefreshToken(data.refreshToken);
  localStorage.setItem(ROLE_KEY, data.role);
  localStorage.setItem(USER_ID_KEY, String(data.userId));
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
  persistSession(data);
  return data;
}

type PasswordResetBody =
  paths["/api/v1/password-reset"]["post"]["requestBody"]["content"]["application/json"];

/**
 * Self-service password reset. Always 202 for a well-formed request (no account enumeration);
 * throws ApiError on 429 (one request per minute per address) or 503 (deployment without email).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const body: PasswordResetBody = { email };
  const res = await fetch(`${API_BASE}/api/v1/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  await fetch(`${API_BASE}/api/v1/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // Include the refresh token so an explicit logout revokes it too, not just the access token.
    body: JSON.stringify({ refreshToken: getRefreshToken() }),
  });
  clearSession();
}

// Exchange the stored refresh token for a fresh access + refresh pair. Returns the new access token,
// or null if there is no refresh token or the server rejected it. Single-flighted: concurrent callers
// (e.g. several requests that all 401 at once) share one in-flight /refresh call.
let refreshInflight: Promise<string | null> | null = null;

export function refresh(): Promise<string | null> {
  if (refreshInflight === null) {
    refreshInflight = doRefresh().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as LoginOk;
  persistSession(data);
  return data.token;
}

export type UserPage = paths["/api/v1/users"]["get"]["responses"]["200"]["content"]["application/json"];

type UserListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  teamId?: number;
};

type CurrentUser = paths["/api/v1/users/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

export async function getCurrentUser(): Promise<CurrentUser> {
  const id = getUserId();
  if (id === null) throw new ApiError(401, null);
  const res = await authedFetch(`/api/v1/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

type CreateUserBody = paths["/api/v1/users"]["post"]["requestBody"]["content"]["application/json"];
type CreateUserResponse = paths["/api/v1/users"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createUser(req: CreateUserBody): Promise<CreateUserResponse> {
  const res = await authedFetch("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateUserResponse;
}

type UserImportBody =
  paths["/api/v1/users/import"]["post"]["requestBody"]["content"]["application/json"];
export type UserImportResult =
  paths["/api/v1/users/import"]["post"]["responses"]["200"]["content"]["application/json"];
export type UserImportRow = UserImportResult["rows"][number];

/** Mass CSV import (ADMIN). 503 when sendEmails is requested on a mail-less deployment. */
export async function importUsers(req: UserImportBody): Promise<UserImportResult> {
  const res = await authedFetch("/api/v1/users/import", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as UserImportResult;
}

type UpdateUserBody =
  paths["/api/v1/users/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getUser(id: number): Promise<CurrentUser> {
  const res = await authedFetch(`/api/v1/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

export async function updateUser(id: number, body: UpdateUserBody): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

type ChangePasswordBody =
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

type FeedbackListQuery = {
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
  /** Only valid with view=team: widen the subject scope from direct reports to the whole management chain. */
  includeIndirect?: boolean;
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
  if (q.includeIndirect) params.set("includeIndirect", "true");
  const res = await authedFetch(`/api/v1/feedbacks?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as FeedbackPage;
}

type CreateFeedbackBody =
  paths["/api/v1/feedbacks"]["post"]["requestBody"]["content"]["application/json"];
type CreateFeedbackResponse =
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
type UpdateFeedbackBody =
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

// Lifecycle transitions are POST action sub-resources (bodyless). An invalid transition from the
// current status returns 409, surfaced as an ApiError like any other failure.
async function feedbackTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/feedbacks/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const sendFeedback = (id: number) => feedbackTransition(id, "send");
export const withdrawFeedback = (id: number) => feedbackTransition(id, "withdraw");
export const rejectFeedback = (id: number) => feedbackTransition(id, "reject");
export const pickUpFeedback = (id: number) => feedbackTransition(id, "pick-up");

export type FeedbackEventList =
  paths["/api/v1/feedbacks/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type FeedbackEvent = FeedbackEventList["items"][number];

export async function listFeedbackEvents(id: number): Promise<FeedbackEvent[]> {
  const res = await authedFetch(`/api/v1/feedbacks/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json() as FeedbackEventList).items;
}

export type OneOnOnePage =
  paths["/api/v1/one-on-ones"]["get"]["responses"]["200"]["content"]["application/json"];

export type ActionItemOwner = "MANAGER" | "SUBORDINATE";

export type OneOnOneListView = "own" | "managed" | "team" | "with";

type OneOnOneListQuery = {
  view: OneOnOneListView;
  page: number;
  pageSize: number;
  sort?: string;
  managerName?: string;
  subordinateName?: string;
  meetingDateGte?: string;
  meetingDateLte?: string;
  /** Only valid with view=team: widen the manager scope from direct reports to the whole management chain. */
  includeIndirect?: boolean;
  /** Required with view=with: the other party's user id (either role direction). */
  counterpartId?: number;
};

export async function listOneOnOnes(q: OneOnOneListQuery): Promise<OneOnOnePage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.managerName) params.set("managerName", q.managerName);
  if (q.subordinateName) params.set("subordinateName", q.subordinateName);
  if (q.meetingDateGte) params.set("meetingDate[gte]", q.meetingDateGte);
  if (q.meetingDateLte) params.set("meetingDate[lte]", q.meetingDateLte);
  if (q.includeIndirect) params.set("includeIndirect", "true");
  if (q.counterpartId != null) params.set("counterpartId", String(q.counterpartId));
  const res = await authedFetch(`/api/v1/one-on-ones?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as OneOnOnePage;
}

export type CreateOneOnOneBody =
  paths["/api/v1/one-on-ones"]["post"]["requestBody"]["content"]["application/json"];
export type OneOnOneResponse =
  paths["/api/v1/one-on-ones/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type UpdateOneOnOneBody =
  paths["/api/v1/one-on-ones/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function createOneOnOne(req: CreateOneOnOneBody): Promise<OneOnOneResponse> {
  const res = await authedFetch("/api/v1/one-on-ones", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as OneOnOneResponse;
}

export async function getOneOnOne(id: number): Promise<OneOnOneResponse> {
  const res = await authedFetch(`/api/v1/one-on-ones/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as OneOnOneResponse;
}

export async function updateOneOnOne(id: number, body: UpdateOneOnOneBody): Promise<void> {
  const res = await authedFetch(`/api/v1/one-on-ones/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteOneOnOne(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/one-on-ones/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type OneOnOneEventList =
  paths["/api/v1/one-on-ones/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type OneOnOneEvent = OneOnOneEventList["items"][number];

export async function listOneOnOneEvents(id: number): Promise<OneOnOneEvent[]> {
  const res = await authedFetch(`/api/v1/one-on-ones/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as OneOnOneEventList).items;
}

export type ActionItemHistoryList =
  paths["/api/v1/one-on-ones/action-items/{id}/history"]["get"]["responses"]["200"]["content"]["application/json"];
export type ActionItemHistoryEntry = ActionItemHistoryList["items"][number];

export async function getActionItemHistory(id: number): Promise<ActionItemHistoryEntry[]> {
  const res = await authedFetch(`/api/v1/one-on-ones/action-items/${id}/history`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as ActionItemHistoryList).items;
}

export type TemplatePage =
  paths["/api/v1/templates"]["get"]["responses"]["200"]["content"]["application/json"];

type TemplateListQuery = {
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

type CreateTemplateBody =
  paths["/api/v1/templates"]["post"]["requestBody"]["content"]["application/json"];
type CreateTemplateResponse =
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
type UpdateTemplateBody =
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

export type AlertPage =
  paths["/api/v1/alerts"]["get"]["responses"]["200"]["content"]["application/json"];

type AlertListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  title?: string;
  isActive?: boolean;
};

export async function listAlerts(q: AlertListQuery): Promise<AlertPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.title) params.set("title", q.title);
  if (q.isActive !== undefined) params.set("isActive", String(q.isActive));
  const res = await authedFetch(`/api/v1/alerts?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as AlertPage;
}

export type CreateAlertBody =
  paths["/api/v1/alerts"]["post"]["requestBody"]["content"]["application/json"];
type CreateAlertResponse =
  paths["/api/v1/alerts"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createAlert(req: CreateAlertBody): Promise<CreateAlertResponse> {
  const res = await authedFetch("/api/v1/alerts", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateAlertResponse;
}

export type AlertResponse =
  paths["/api/v1/alerts/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateAlertBody =
  paths["/api/v1/alerts/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getAlert(id: number): Promise<AlertResponse> {
  const res = await authedFetch(`/api/v1/alerts/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as AlertResponse;
}

export async function updateAlert(id: number, body: UpdateAlertBody): Promise<void> {
  const res = await authedFetch(`/api/v1/alerts/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteAlert(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/alerts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type VisibleAlertList =
  paths["/api/v1/alerts/visible"]["get"]["responses"]["200"]["content"]["application/json"];
export type VisibleAlert = VisibleAlertList["items"][number];

export async function getVisibleAlerts(): Promise<VisibleAlert[]> {
  const res = await authedFetch("/api/v1/alerts/visible");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as VisibleAlertList).items;
}

export type NotificationPage =
  paths["/api/v1/notifications"]["get"]["responses"]["200"]["content"]["application/json"];
export type NotificationItem = NotificationPage["items"][number];

type NotificationListQuery = {
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
  let res = await sendWithToken(path, init, getToken());
  if (res.status === 401) {
    // The access token is likely expired. Try one silent refresh (single-flighted), then retry once.
    const newToken = await refresh();
    if (newToken !== null) {
      res = await sendWithToken(path, init, newToken);
    } else {
      // No refresh token, or the server rejected it — the session is over.
      clearSession();
      flagSignedOut();
      notifyAuthChange();
    }
  }
  return res;
}

function sendWithToken(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${API_BASE}${path}`, { ...init, headers });
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
