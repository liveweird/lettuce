import type { components, paths } from "./schema";
import { flagSignedOut, notifyAuthChange } from "../auth";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const TOKEN_KEY = "lettuce.auth.token";
const REFRESH_TOKEN_KEY = "lettuce.auth.refreshToken";
const ROLES_KEY = "lettuce.auth.roles";
// Pre-roles-set sessions stored a single role under this key; clearSession removes it too.
const LEGACY_ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

/** Additional roles — every user is implicitly a regular user; an empty set means no extra privileges. */
export const USER_ROLES = ["ADMIN", "HR"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

/**
 * The per-user-toggleable feature areas (v1.53.0), in the UI's display order.
 * MFA (v2.4.0) is the one inverted-default flag: every user starts with it DISABLED
 * (opt-in email MFA at login); it gates the login flow server-side, never any SPA surface —
 * no nav leaf, page guard, or card gating names it.
 */
export const FEATURES = [
  "FEEDBACKS",
  "ONE_ON_ONES",
  "GOALS",
  "TEAM_KPIS",
  "PERFORMANCE_REVIEWS",
  "DAYS_OFF",
  "PULSE_SURVEYS",
  "MFA",
] as const;
export type Feature = (typeof FEATURES)[number];

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

export function getRoles(): UserRole[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROLES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is UserRole => USER_ROLES.includes(r)) : [];
  } catch {
    return [];
  }
}

export function getUserId(): number | null {
  const raw = localStorage.getItem(USER_ID_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The session user's admin-disabled features. Missing key or corrupt value = all enabled —
 * pre-v1.53.0 sessions (and mid-deploy older servers) keep full access until their next
 * login/refresh. Render-time reads like isAdmin() — a change reaches a logged-in victim via
 * the ≤15-min token refresh, and route guards + server 403s cover the gap.
 */
export function getDisabledFeatures(): Feature[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISABLED_FEATURES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((f): f is Feature => FEATURES.includes(f)) : [];
  } catch {
    return [];
  }
}

export function hasFeature(feature: Feature): boolean {
  return !getDisabledFeatures().includes(feature);
}

export function isAdmin(): boolean {
  return getRoles().includes("ADMIN");
}

export function isHr(): boolean {
  return getRoles().includes("HR");
}

/** May use the auditor read surface (view=user + the Audit section) — HR-only since v1.26.0. */
export function canAudit(): boolean {
  return isHr();
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ROLES_KEY);
  localStorage.removeItem(LEGACY_ROLE_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(DISABLED_FEATURES_KEY);
}

// Persist the access + refresh pair (and the current roles/userId/feature flags) returned by
// /login, /login/mfa, or /refresh. `?? []` keeps a mid-deploy older server (no disabledFeatures
// yet) harmless.
function persistSession(data: LoginSuccess): void {
  setToken(data.token);
  setRefreshToken(data.refreshToken);
  localStorage.setItem(ROLES_KEY, JSON.stringify(data.roles));
  localStorage.setItem(USER_ID_KEY, String(data.userId));
  localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(data.disabledFeatures ?? []));
}

type LoginBody = paths["/api/v1/login"]["post"]["requestBody"]["content"]["application/json"];
// Tokens, or (MFA-enabled accounts) a second-factor challenge — discriminate via isMfaChallenge.
type LoginOk = paths["/api/v1/login"]["post"]["responses"]["200"]["content"]["application/json"];
type LoginSuccess = components["schemas"]["LoginResponse"];
export type MfaChallenge = components["schemas"]["MfaChallengeResponse"];

export function isMfaChallenge(data: LoginOk): data is MfaChallenge {
  return "mfaRequired" in data;
}

export async function login(credentials: LoginBody): Promise<LoginOk> {
  const res = await fetch(`${API_BASE}/api/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  const data = (await res.json()) as LoginOk;
  // An MFA challenge carries no tokens — the session starts only after verifyMfa.
  if (!isMfaChallenge(data)) persistSession(data);
  return data;
}

type MfaVerifyBody =
  paths["/api/v1/login/mfa"]["post"]["requestBody"]["content"]["application/json"];

/**
 * Second login step for MFA-enabled accounts: exchanges the challenge id + emailed 6-digit
 * code for the ordinary token pair (persisted like a login). Throws ApiError on 401
 * (invalid/expired code), 403 (account deactivated meanwhile), or 429 (rate-limited).
 */
export async function verifyMfa(challengeId: string, code: string): Promise<LoginSuccess> {
  const body: MfaVerifyBody = { challengeId, code };
  const res = await fetch(`${API_BASE}/api/v1/login/mfa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  const data = (await res.json()) as LoginSuccess;
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
  const data = (await res.json()) as LoginSuccess;
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
  deactivated?: boolean;
  // Feature-flag state filter — the server requires the pair together (400 otherwise),
  // so listUsers serializes them only when `feature` is set.
  feature?: Feature;
  featureEnabled?: boolean;
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

// ——— Career positions (v2.15.0) ———

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

// Reversible account disable — the goalTransition shape (POST action endpoints, ADMIN-only).
async function userAccountTransition(id: number, action: "deactivate" | "activate"): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const deactivateUser = (id: number) => userAccountTransition(id, "deactivate");
export const reactivateUser = (id: number) => userAccountTransition(id, "activate");

/**
 * Wholesale-replaces a user's disabled-feature set (ADMIN-only). On a successful self-edit the
 * stored session flags update immediately — an admin trimming their own features sees the UI
 * react without waiting for the next token refresh.
 */
export async function updateUserFeatures(id: number, disabledFeatures: Feature[]): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}/features`, {
    method: "PUT",
    body: JSON.stringify({ disabledFeatures }),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  if (id === getUserId()) {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(disabledFeatures));
  }
}

/**
 * Toggles the email mirror of in-app notifications (v2.3.0) — target user or ADMIN.
 * Takes effect at the next minted notification (read at send time, no token staleness).
 */
export async function setEmailNotifications(id: number, enabled: boolean): Promise<void> {
  const res = await authedFetch(`/api/v1/users/${id}/email-notifications`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
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
  // != null on purpose: false ("only active") is a meaningful filter value.
  if (q.deactivated != null) params.set("deactivated", String(q.deactivated));
  if (q.feature && q.featureEnabled != null) {
    params.set("feature", q.feature);
    params.set("featureEnabled", String(q.featureEnabled));
  }
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

/** Every user (optionally: of one team), paging until the server total is reached — the
 * listAllTeams idiom. */
export async function listAllUsers(filter: { teamId?: number } = {}): Promise<UserPage["items"]> {
  const items: UserPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listUsers({ page, pageSize: 100, sort: "id", ...filter });
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

export type FeedbackPage =
  paths["/api/v1/feedbacks"]["get"]["responses"]["200"]["content"]["application/json"];

export type FeedbackVisibility =
  | "PROVIDER_SUBJECT"
  | "PROVIDER_REQUESTER"
  | "PROVIDER_REQUESTER_SUBJECT"
  | "PUBLIC";
export type FeedbackStatus = "REQUESTED" | "DRAFT" | "SENT" | "WITHDRAWN" | "REJECTED";

export type FeedbackListView = "received" | "provided" | "team" | "user" | "kudos";

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
  /** Required with view=user (the HR auditor view): whose records to list. */
  userId?: number;
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
  if (q.userId != null) params.set("userId", String(q.userId));
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

export type DuplicateCheckResponse =
  paths["/api/v1/feedbacks/duplicate-check"]["get"]["responses"]["200"]["content"]["application/json"];

// The no-duplicate early check backing the create screens' warning (see FeedbackForm/create pages).
export async function checkFeedbackDuplicate(params: {
  subjectId: number;
  providerId: number;
  requesterId?: number;
}): Promise<DuplicateCheckResponse> {
  const query = new URLSearchParams({
    subjectId: String(params.subjectId),
    providerId: String(params.providerId),
  });
  if (params.requesterId != null) query.set("requesterId", String(params.requesterId));
  const res = await authedFetch(`/api/v1/feedbacks/duplicate-check?${query}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DuplicateCheckResponse;
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

export type OneOnOneListView = "own" | "managed" | "team" | "with" | "user";

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
  /** Required with view=user (the HR auditor view): whose records to list. */
  userId?: number;
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
  if (q.userId != null) params.set("userId", String(q.userId));
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

export type GoalPage =
  paths["/api/v1/goals"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalListItem = GoalPage["items"][number];
export type GoalResponse =
  paths["/api/v1/goals/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalStatus = GoalResponse["status"];
export type GoalType = GoalResponse["type"];

export type GoalListView = "own" | "managed" | "team" | "user";

type GoalListQuery = {
  view: GoalListView;
  page: number;
  pageSize: number;
  sort?: string;
  title?: string;
  managerName?: string;
  subordinateName?: string;
  status?: GoalStatus;
  type?: GoalType;
  managerId?: number;
  subordinateId?: number;
  createdAtGte?: number;
  /** Only valid with view=team: widen the manager scope from direct reports to the whole management chain. */
  includeIndirect?: boolean;
  /** Required with view=user (the HR auditor view): whose records to list. */
  userId?: number;
};

export async function listGoals(q: GoalListQuery): Promise<GoalPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.title) params.set("title", q.title);
  if (q.managerName) params.set("managerName", q.managerName);
  if (q.subordinateName) params.set("subordinateName", q.subordinateName);
  if (q.status) params.set("status", q.status);
  if (q.type) params.set("type", q.type);
  if (q.managerId != null) params.set("managerId", String(q.managerId));
  if (q.subordinateId != null) params.set("subordinateId", String(q.subordinateId));
  if (q.createdAtGte != null) params.set("createdAt[gte]", String(q.createdAtGte));
  if (q.includeIndirect) params.set("includeIndirect", "true");
  if (q.userId != null) params.set("userId", String(q.userId));
  const res = await authedFetch(`/api/v1/goals?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as GoalPage;
}

export type GoalCreateBody =
  paths["/api/v1/goals"]["post"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT; the caller is the manager and the subordinate must be a direct report.
export async function createGoal(body: GoalCreateBody): Promise<GoalResponse> {
  const res = await authedFetch("/api/v1/goals", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as GoalResponse;
}

export type GoalDefinitionUpdateBody =
  paths["/api/v1/goals/{id}"]["put"]["requestBody"]["content"]["application/json"];
export type GoalProgressUpdateBody =
  paths["/api/v1/goals/{id}/progress"]["put"]["requestBody"]["content"]["application/json"];
type GoalArchiveBody =
  paths["/api/v1/goals/{id}/archive"]["post"]["requestBody"]["content"]["application/json"];

export async function getGoal(id: number): Promise<GoalResponse> {
  const res = await authedFetch(`/api/v1/goals/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as GoalResponse;
}

export async function updateGoalDefinition(id: number, body: GoalDefinitionUpdateBody): Promise<void> {
  const res = await authedFetch(`/api/v1/goals/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function updateGoalProgress(id: number, body: GoalProgressUpdateBody): Promise<void> {
  const res = await authedFetch(`/api/v1/goals/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteGoal(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/goals/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// Lifecycle transitions are POST action sub-resources; each names one edge of the
// DRAFT <-> ACTIVE <-> ARCHIVED machine, so a goal not at the edge's source status returns 409.
async function goalTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/goals/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const activateGoal = (id: number) => goalTransition(id, "activate");
export const deactivateGoal = (id: number) => goalTransition(id, "deactivate");
export const reopenGoal = (id: number) => goalTransition(id, "reopen");

// Close is the one bodied transition — it always records the summary.
export async function archiveGoal(id: number, body: GoalArchiveBody): Promise<void> {
  const res = await authedFetch(`/api/v1/goals/${id}/archive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type GoalEventList =
  paths["/api/v1/goals/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalEvent = GoalEventList["items"][number];

export async function listGoalEvents(id: number): Promise<GoalEvent[]> {
  const res = await authedFetch(`/api/v1/goals/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as GoalEventList).items;
}

export type TeamKpiPage =
  paths["/api/v1/team-kpis"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiListItem = TeamKpiPage["items"][number];
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
  const res = await authedFetch(`/api/v1/team-kpis?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as TeamKpiPage;
}

export type TeamKpiCreateBody =
  paths["/api/v1/team-kpis"]["post"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT; the caller must be the team's current manager.
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
export type TeamKpiValueList =
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

// Data points are only mutable while the KPI is ACTIVE (409 otherwise); a duplicate date is
// also 409 — at most one value per date.
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

export type TeamKpiEventList =
  paths["/api/v1/team-kpis/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type TeamKpiEvent = TeamKpiEventList["items"][number];

// ── Dashboard ────────────────────────────────────────────────────────────────────────────────

export type DashboardSummary =
  paths["/api/v1/dashboard/summary"]["get"]["responses"]["200"]["content"]["application/json"];

/** The caller's at-a-glance numbers for the Dashboard hero tiles — strictly caller-scoped. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await authedFetch("/api/v1/dashboard/summary");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DashboardSummary;
}

// ── Review periods & performance reviews ─────────────────────────────────────────────────────

export type ReviewPeriod =
  paths["/api/v1/review-periods"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type ReviewPeriodCreateBody =
  paths["/api/v1/review-periods"]["post"]["requestBody"]["content"]["application/json"];

/** The whole global timeline, oldest first — unpaged (the registry is intrinsically small). */
export async function listReviewPeriods(): Promise<ReviewPeriod[]> {
  const res = await authedFetch("/api/v1/review-periods");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: ReviewPeriod[] }).items;
}

// ADMIN-only; the timeline is append-only — a start not adjacent to the latest end is 409.
export async function createReviewPeriod(body: ReviewPeriodCreateBody): Promise<ReviewPeriod> {
  const res = await authedFetch("/api/v1/review-periods", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as ReviewPeriod;
}

// ADMIN-only; only the latest, review-free period deletes (else 409).
export async function deleteReviewPeriod(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/review-periods/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type PerformanceReviewPage =
  paths["/api/v1/performance-reviews"]["get"]["responses"]["200"]["content"]["application/json"];
export type PerformanceReviewListItem = PerformanceReviewPage["items"][number];
export type PerformanceReviewResponse =
  paths["/api/v1/performance-reviews/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type PerformanceReviewStatus = PerformanceReviewResponse["status"];
export type CategoryAssessment = PerformanceReviewResponse["attitude"];

export type PerformanceReviewListView = "own" | "managed" | "team" | "user";

type PerformanceReviewListQuery = {
  view: PerformanceReviewListView;
  page: number;
  pageSize: number;
  sort?: string;
  managerName?: string;
  subordinateName?: string;
  status?: PerformanceReviewStatus;
  managerId?: number;
  subordinateId?: number;
  /** Exact period match — the per-period dashboard/table filter. */
  periodId?: number;
  createdAtGte?: number;
  /** Only valid with view=managed/team: widen from the caller's own to the whole chain. */
  includeIndirect?: boolean;
  /** Required with view=user (the HR auditor view): whose records to list. */
  userId?: number;
};

export async function listPerformanceReviews(
  q: PerformanceReviewListQuery,
): Promise<PerformanceReviewPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.managerName) params.set("managerName", q.managerName);
  if (q.subordinateName) params.set("subordinateName", q.subordinateName);
  if (q.status) params.set("status", q.status);
  if (q.managerId != null) params.set("managerId", String(q.managerId));
  if (q.subordinateId != null) params.set("subordinateId", String(q.subordinateId));
  if (q.periodId != null) params.set("periodId", String(q.periodId));
  if (q.createdAtGte != null) params.set("createdAt[gte]", String(q.createdAtGte));
  if (q.includeIndirect) params.set("includeIndirect", "true");
  if (q.userId != null) params.set("userId", String(q.userId));
  const res = await authedFetch(`/api/v1/performance-reviews?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PerformanceReviewPage;
}

/** Every review of one scope, paging until the server total is reached — the reviews-dashboard
 * client-side join fetches a whole period this way (org-bounded, like the card grids). */
export async function listAllPerformanceReviews(
  q: Omit<PerformanceReviewListQuery, "page" | "pageSize">,
): Promise<PerformanceReviewPage["items"]> {
  const items: PerformanceReviewPage["items"] = [];
  let page = 1;
  for (;;) {
    const result = await listPerformanceReviews({ ...q, page, pageSize: 100 });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

export type PerformanceReviewCreateBody =
  paths["/api/v1/performance-reviews"]["post"]["requestBody"]["content"]["application/json"];
export type PerformanceReviewUpdateBody =
  paths["/api/v1/performance-reviews/{id}"]["put"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT (assessments may be partial); the caller is the manager and the
// subordinate must be a direct report. An occupied (subordinate, period) slot is 409 whose
// ProblemDetail.instance points at the existing review.
export async function createPerformanceReview(
  body: PerformanceReviewCreateBody,
): Promise<PerformanceReviewResponse> {
  const res = await authedFetch("/api/v1/performance-reviews", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PerformanceReviewResponse;
}

export async function getPerformanceReview(id: number): Promise<PerformanceReviewResponse> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PerformanceReviewResponse;
}

// Full replace of the eight assessment values; DRAFT/CALIBRATION only (PUBLISHED is 409), and
// in CALIBRATION the payload must stay complete (400).
export async function updatePerformanceReview(
  id: number,
  body: PerformanceReviewUpdateBody,
): Promise<void> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deletePerformanceReview(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// Lifecycle transitions are POST action sub-resources; each names one edge of the
// DRAFT <-> CALIBRATION <-> PUBLISHED machine, so a review not at the edge's source status
// returns 409 (and an incomplete draft's submit is 400).
async function reviewTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const submitPerformanceReview = (id: number) => reviewTransition(id, "submit");
export const revertPerformanceReview = (id: number) => reviewTransition(id, "revert");
export const publishPerformanceReview = (id: number) => reviewTransition(id, "publish");
export const unpublishPerformanceReview = (id: number) => reviewTransition(id, "unpublish");

export type PerformanceReviewEventList =
  paths["/api/v1/performance-reviews/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type PerformanceReviewEvent = PerformanceReviewEventList["items"][number];

export async function listPerformanceReviewEvents(id: number): Promise<PerformanceReviewEvent[]> {
  const res = await authedFetch(`/api/v1/performance-reviews/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as PerformanceReviewEventList).items;
}

export async function listTeamKpiEvents(id: number): Promise<TeamKpiEvent[]> {
  const res = await authedFetch(`/api/v1/team-kpis/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as TeamKpiEventList).items;
}

// ── Days off & public holidays ───────────────────────────────────────────────────────────────

export type DaysOffPage =
  paths["/api/v1/days-off"]["get"]["responses"]["200"]["content"]["application/json"];
export type DaysOffListItem = DaysOffPage["items"][number];
export type DaysOffResponse =
  paths["/api/v1/days-off/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type DaysOffStatus = DaysOffResponse["status"];
export type DaysOffType = DaysOffResponse["type"];

export type DaysOffListView = "own" | "managed" | "user";

type DaysOffListQuery = {
  view: DaysOffListView;
  page: number;
  pageSize: number;
  sort?: string;
  userName?: string;
  type?: DaysOffType;
  status?: DaysOffStatus;
  startDateGte?: string;
  startDateLte?: string;
  /** Required with view=user (the HR auditor view); a pin-filter with view=managed. */
  userId?: number;
};

export async function listDaysOff(q: DaysOffListQuery): Promise<DaysOffPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.userName) params.set("userName", q.userName);
  if (q.type) params.set("type", q.type);
  if (q.status) params.set("status", q.status);
  if (q.startDateGte) params.set("startDate[gte]", q.startDateGte);
  if (q.startDateLte) params.set("startDate[lte]", q.startDateLte);
  if (q.userId != null) params.set("userId", String(q.userId));
  const res = await authedFetch(`/api/v1/days-off?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffPage;
}

export type DaysOffCreateBody =
  paths["/api/v1/days-off"]["post"]["requestBody"]["content"]["application/json"];

// Always enters REQUESTED; the owner is the caller. Overlap and paid-budget violations are 409
// (the overlap's ProblemDetail.instance points at the conflicting request).
export async function createDaysOff(body: DaysOffCreateBody): Promise<DaysOffResponse> {
  const res = await authedFetch("/api/v1/days-off", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffResponse;
}

// Lifecycle actions: accept/reject are the direct manager's resolution of a REQUESTED request;
// cancel is the owner's withdrawal (REQUESTED anytime, ACCEPTED only before the start date).
// A request not in the action's source status returns 409.
async function daysOffTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/days-off/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const acceptDaysOff = (id: number) => daysOffTransition(id, "accept");
export const rejectDaysOff = (id: number) => daysOffTransition(id, "reject");
export const cancelDaysOff = (id: number) => daysOffTransition(id, "cancel");

export type DaysOffCalendarResponse =
  paths["/api/v1/days-off/calendar"]["get"]["responses"]["200"]["content"]["application/json"];
export type DaysOffCalendarUser = DaysOffCalendarResponse["users"][number];
export type DaysOffCalendarEntry = DaysOffCalendarUser["entries"][number];
export type DaysOffCalendarScope = "member" | "managed";

/** The month's leave-planner payload (unpaged): the scope's users with their marked days
 * plus the month's public holidays. */
export async function getDaysOffCalendar(
  month: string,
  scope: DaysOffCalendarScope,
): Promise<DaysOffCalendarResponse> {
  const res = await authedFetch(`/api/v1/days-off/calendar?month=${month}&scope=${scope}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffCalendarResponse;
}

export type DaysOffBudget =
  paths["/api/v1/days-off/budgets"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type DaysOffBudgetView = "own" | "managed";

/** Per-user paid-days budget rows for a calendar year (own = one row, managed = direct reports). */
export async function listDaysOffBudgets(
  view: DaysOffBudgetView,
  year: number,
): Promise<DaysOffBudget[]> {
  const res = await authedFetch(`/api/v1/days-off/budgets?view=${view}&year=${year}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: DaysOffBudget[] }).items;
}

export type DaysOffCorrection =
  paths["/api/v1/days-off/corrections"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type DaysOffCorrectionWrite =
  paths["/api/v1/days-off/corrections"]["post"]["requestBody"]["content"]["application/json"];
export type DaysOffCorrectionOperation = DaysOffCorrection["operation"];

/** A user's active budget corrections, newest first — unpaged (intrinsically few). */
export async function listDaysOffCorrections(userId: number, year?: number): Promise<DaysOffCorrection[]> {
  const params = new URLSearchParams({ userId: String(userId) });
  if (year != null) params.set("year", String(year));
  const res = await authedFetch(`/api/v1/days-off/corrections?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: DaysOffCorrection[] }).items;
}

// Current-direct-manager only; the subordinate is notified.
export async function createDaysOffCorrection(body: DaysOffCorrectionWrite): Promise<DaysOffCorrection> {
  const res = await authedFetch("/api/v1/days-off/corrections", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffCorrection;
}

// The target user is immutable (the payload's userId is ignored server-side).
export async function updateDaysOffCorrection(id: number, body: DaysOffCorrectionWrite): Promise<void> {
  const res = await authedFetch(`/api/v1/days-off/corrections/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// Soft delete — the correction drops out of the list and the budget math.
export async function deleteDaysOffCorrection(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/days-off/corrections/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type PublicHoliday =
  paths["/api/v1/public-holidays"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type PublicHolidayCreateBody =
  paths["/api/v1/public-holidays"]["post"]["requestBody"]["content"]["application/json"];

/** The whole global registry, oldest date first — unpaged (the review-periods shape). */
export async function listPublicHolidays(): Promise<PublicHoliday[]> {
  const res = await authedFetch("/api/v1/public-holidays");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: PublicHoliday[] }).items;
}

// ADMIN-only; a duplicate date is 409.
export async function createPublicHoliday(body: PublicHolidayCreateBody): Promise<PublicHoliday> {
  const res = await authedFetch("/api/v1/public-holidays", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PublicHoliday;
}

// ADMIN-only; hard delete (existing request costs stay frozen).
export async function deletePublicHoliday(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/public-holidays/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
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

export type DictionarySlug =
  | "career-paths"
  | "career-specializations"
  | "seniority-levels"
  | "pulse-rotating-questions";
export type DictionaryEntry = components["schemas"]["DictionaryEntry"];
export type DictionaryUpdateBody = components["schemas"]["DictionaryUpdateRequest"];
type DictionaryEntryListResponse =
  paths["/api/v1/dictionaries/{dictionary}"]["get"]["responses"]["200"]["content"]["application/json"];

/** The dictionary's active entries in the admin-curated order (unpaged — at most 200). */
export async function getDictionary(slug: DictionarySlug): Promise<DictionaryEntry[]> {
  const res = await authedFetch(`/api/v1/dictionaries/${slug}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as DictionaryEntryListResponse).items;
}

/** Whole-document replace (ADMIN): payload order becomes the stored order. */
export async function updateDictionary(slug: DictionarySlug, body: DictionaryUpdateBody): Promise<void> {
  const res = await authedFetch(`/api/v1/dictionaries/${slug}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}


// ——— Pulse surveys (v2.0.0) ———

export type PulseCycle = components["schemas"]["PulseCycle"];
export type PulseCycleStatus = PulseCycle["status"];
export type PulseScaleAnswer = components["schemas"]["PulseScaleAnswer"];
export type PulseSubmitBody = components["schemas"]["PulseResponseSubmitRequest"];
export type PulseMyResponse = components["schemas"]["PulseMyResponse"];
export type PulseTeamResults = components["schemas"]["PulseTeamResults"];
export type PulseDriverResult = components["schemas"]["PulseDriverResult"];
export type PulseAggregationMode = components["schemas"]["PulseAggregationMode"];
export type PulseTrendResponse = components["schemas"]["PulseTrendResponse"];
export type PulseTrendPoint = components["schemas"]["PulseTrendPoint"];
export type PulseCommentsResponse = components["schemas"]["PulseCommentsResponse"];
export type PulseParticipationStatus = components["schemas"]["PulseParticipationStatusResponse"];
export type PulseVisibleTeams = components["schemas"]["PulseVisibleTeams"];
export type TeamRef = components["schemas"]["TeamRef"];
export type PulseSettings = components["schemas"]["PulseSettings"];
type PulseCycleListResponse =
  paths["/api/v1/pulse-surveys/cycles"]["get"]["responses"]["200"]["content"]["application/json"];

/** All cycles, newest first (unpaged registry). Admin rows carry the participation counts. */
export async function listPulseCycles(): Promise<PulseCycle[]> {
  const res = await authedFetch("/api/v1/pulse-surveys/cycles");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as PulseCycleListResponse).items;
}

export async function createPulseCycle(body: {
  plannedOpenDate: string;
  plannedCloseDate: string;
}): Promise<PulseCycle> {
  const res = await authedFetch("/api/v1/pulse-surveys/cycles", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseCycle;
}

export async function updatePulseCycleDates(
  id: number,
  body: { plannedOpenDate: string; plannedCloseDate: string },
): Promise<void> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// The lifecycle transitions are POST action sub-resources, funneled through one helper.
async function pulseCycleTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
export const openPulseCycle = (id: number) => pulseCycleTransition(id, "open");
export const closePulseCycle = (id: number) => pulseCycleTransition(id, "close");
export const cancelPulseCycle = (id: number) => pulseCycleTransition(id, "cancel");

/** The caller's saved answers for an OPEN cycle — 404 before the first submit, 409 once closed. */
export async function getMyPulseResponse(cycleId: number): Promise<PulseMyResponse> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseMyResponse;
}

export async function submitMyPulseResponse(cycleId: number, body: PulseSubmitBody): Promise<void> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function getPulseResults(
  cycleId: number,
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseTeamResults> {
  const res = await authedFetch(
    `/api/v1/pulse-surveys/cycles/${cycleId}/results?teamId=${teamId}&mode=${mode}`,
  );
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseTeamResults;
}

export async function getPulseComments(
  cycleId: number,
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseCommentsResponse> {
  const res = await authedFetch(
    `/api/v1/pulse-surveys/cycles/${cycleId}/comments?teamId=${teamId}&mode=${mode}`,
  );
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseCommentsResponse;
}

export async function getPulseTrend(
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseTrendResponse> {
  const res = await authedFetch(`/api/v1/pulse-surveys/trend?teamId=${teamId}&mode=${mode}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseTrendResponse;
}

/** Managers' per-person submitted yes/no over their monitored teams (HR: whole org). */
export async function getPulseParticipationStatus(cycleId: number): Promise<PulseParticipationStatus> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${cycleId}/participation-status`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseParticipationStatus;
}

export async function getPulseVisibleTeams(): Promise<PulseVisibleTeams> {
  const res = await authedFetch("/api/v1/pulse-surveys/visible-teams");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseVisibleTeams;
}

export async function getPulseSettings(): Promise<PulseSettings> {
  const res = await authedFetch("/api/v1/pulse-surveys/settings");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseSettings;
}

export async function updatePulseSettings(body: PulseSettings): Promise<void> {
  const res = await authedFetch("/api/v1/pulse-surveys/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
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

export async function deleteNotification(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/${id}`, { method: "DELETE" });
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
