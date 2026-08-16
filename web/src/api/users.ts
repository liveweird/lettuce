// Users API — accounts, roles, flags, import, and the account lifecycle actions.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";
import { type Feature, getUserId, setStoredDisabledFeatures, type UserRole } from "./session";

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
    setStoredDisabledFeatures(disabledFeatures);
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
