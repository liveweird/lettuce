// Goals API — CRUD, progress, lifecycle transitions, and the event history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

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

type GoalEventList =
  paths["/api/v1/goals/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalEvent = GoalEventList["items"][number];

export async function listGoalEvents(id: number): Promise<GoalEvent[]> {
  const res = await authedFetch(`/api/v1/goals/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as GoalEventList).items;
}
