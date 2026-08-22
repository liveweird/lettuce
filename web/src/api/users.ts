// Users API — accounts, roles, flags, import, and the account lifecycle actions.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, buildQuery, jsonRequest, voidRequest } from "./http";
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
  uniqueId?: string;
  // Presence filter: true = only users missing a unique id, false = only users having one.
  uniqueIdMissing?: boolean;
};

type CurrentUser = paths["/api/v1/users/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

export async function getCurrentUser(): Promise<CurrentUser> {
  const id = getUserId();
  if (id === null) throw new ApiError(401, null);
  return jsonRequest<CurrentUser>(`/api/v1/users/${id}`);
}

type CreateUserBody = paths["/api/v1/users"]["post"]["requestBody"]["content"]["application/json"];
type CreateUserResponse = paths["/api/v1/users"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createUser(req: CreateUserBody): Promise<CreateUserResponse> {
  return jsonRequest<CreateUserResponse>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

type UserImportBody =
  paths["/api/v1/users/import"]["post"]["requestBody"]["content"]["application/json"];
export type UserImportResult =
  paths["/api/v1/users/import"]["post"]["responses"]["200"]["content"]["application/json"];
export type UserImportRow = UserImportResult["rows"][number];

/** Mass CSV import (ADMIN). 503 when sendEmails is requested on a mail-less deployment. */
export async function importUsers(req: UserImportBody): Promise<UserImportResult> {
  return jsonRequest<UserImportResult>("/api/v1/users/import", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

type UpdateUserBody =
  paths["/api/v1/users/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getUser(id: number): Promise<CurrentUser> {
  return jsonRequest<CurrentUser>(`/api/v1/users/${id}`);
}

export async function updateUser(id: number, body: UpdateUserBody): Promise<void> {
  await voidRequest(`/api/v1/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

type ChangePasswordBody =
  paths["/api/v1/users/{id}/password"]["put"]["requestBody"]["content"]["application/json"];

export async function changeUserPassword(id: number, body: ChangePasswordBody): Promise<void> {
  await voidRequest(`/api/v1/users/${id}/password`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteUser(id: number): Promise<void> {
  await voidRequest(`/api/v1/users/${id}`, { method: "DELETE" });
}

// Reversible account disable — the goalTransition shape (POST action endpoints, ADMIN-only).
async function userAccountTransition(id: number, action: "deactivate" | "activate"): Promise<void> {
  await voidRequest(`/api/v1/users/${id}/${action}`, { method: "POST" });
}

export const deactivateUser = (id: number) => userAccountTransition(id, "deactivate");
export const reactivateUser = (id: number) => userAccountTransition(id, "activate");

/**
 * Wholesale-replaces a user's disabled-feature set (ADMIN-only). On a successful self-edit the
 * stored session flags update immediately — an admin trimming their own features sees the UI
 * react without waiting for the next token refresh.
 */
export async function updateUserFeatures(id: number, disabledFeatures: Feature[]): Promise<void> {
  await voidRequest(`/api/v1/users/${id}/features`, {
    method: "PUT",
    body: JSON.stringify({ disabledFeatures }),
  });
  if (id === getUserId()) {
    setStoredDisabledFeatures(disabledFeatures);
  }
}

/**
 * Toggles the email mirror of in-app notifications (v2.3.0) — target user or ADMIN.
 * Takes effect at the next minted notification (read at send time, no token staleness).
 */
export async function setEmailNotifications(id: number, enabled: boolean): Promise<void> {
  await voidRequest(`/api/v1/users/${id}/email-notifications`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

/**
 * Sets the user's language (v2.21.0) — target user or ADMIN. Applied to the UI at sign-in
 * and used for every email sent to the user (read at send time, no token staleness).
 */
export async function setUserLanguage(id: number, language: string): Promise<void> {
  await voidRequest(`/api/v1/users/${id}/language`, {
    method: "PUT",
    body: JSON.stringify({ language }),
  });
}

export async function listUsers(q: UserListQuery): Promise<UserPage> {
  // The feature/featureEnabled pair only travels together (the server requires both).
  const featurePair = q.feature && q.featureEnabled != null;
  const params = buildQuery({
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    name: q.name,
    email: q.email,
    role: q.role,
    teamId: q.teamId,
    // buildQuery keeps false: "only active" is a meaningful deactivated filter value.
    deactivated: q.deactivated,
    feature: featurePair ? q.feature : undefined,
    featureEnabled: featurePair ? q.featureEnabled : undefined,
    uniqueId: q.uniqueId,
    uniqueIdMissing: q.uniqueIdMissing,
  });
  return jsonRequest<UserPage>(`/api/v1/users?${params}`);
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
