// Goals API — CRUD, progress, lifecycle transitions, and the event history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

export type GoalPage =
  paths["/api/v1/goals"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalListItem = GoalPage["items"][number];
export type GoalResponse =
  paths["/api/v1/goals/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalStatus = GoalResponse["status"];
export type GoalType = GoalResponse["type"];
// The at-least/at-most target semantic (v2.41.0), shared with team KPIs.
export type TargetDirection = NonNullable<GoalResponse["targetDirection"]>;

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
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    title: q.title,
    managerName: q.managerName,
    subordinateName: q.subordinateName,
    status: q.status,
    type: q.type,
    managerId: q.managerId,
    subordinateId: q.subordinateId,
    "createdAt[gte]": q.createdAtGte,
    includeIndirect: q.includeIndirect || undefined,
    userId: q.userId,
  });
  return jsonRequest<GoalPage>(`/api/v1/goals?${params}`);
}

export type GoalCreateBody =
  paths["/api/v1/goals"]["post"]["requestBody"]["content"]["application/json"];

// Always creates a DRAFT; the caller is the manager and the subordinate must be a direct report.
export async function createGoal(body: GoalCreateBody): Promise<GoalResponse> {
  return jsonRequest<GoalResponse>("/api/v1/goals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type GoalDefinitionUpdateBody =
  paths["/api/v1/goals/{id}"]["put"]["requestBody"]["content"]["application/json"];
export type GoalProgressUpdateBody =
  paths["/api/v1/goals/{id}/progress"]["put"]["requestBody"]["content"]["application/json"];
type GoalArchiveBody =
  paths["/api/v1/goals/{id}/archive"]["post"]["requestBody"]["content"]["application/json"];

export async function getGoal(id: number): Promise<GoalResponse> {
  return jsonRequest<GoalResponse>(`/api/v1/goals/${id}`);
}

export async function updateGoalDefinition(id: number, body: GoalDefinitionUpdateBody): Promise<void> {
  await voidRequest(`/api/v1/goals/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function updateGoalProgress(id: number, body: GoalProgressUpdateBody): Promise<void> {
  await voidRequest(`/api/v1/goals/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteGoal(id: number): Promise<void> {
  await voidRequest(`/api/v1/goals/${id}`, { method: "DELETE" });
}

// Lifecycle transitions are POST action sub-resources; each names one edge of the
// DRAFT <-> ACTIVE <-> ARCHIVED machine, so a goal not at the edge's source status returns 409.
async function goalTransition(id: number, action: string): Promise<void> {
  await voidRequest(`/api/v1/goals/${id}/${action}`, { method: "POST" });
}

export const activateGoal = (id: number) => goalTransition(id, "activate");
export const deactivateGoal = (id: number) => goalTransition(id, "deactivate");
export const reopenGoal = (id: number) => goalTransition(id, "reopen");

// Close is the one bodied transition — it always records the summary.
export async function archiveGoal(id: number, body: GoalArchiveBody): Promise<void> {
  await voidRequest(`/api/v1/goals/${id}/archive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

type GoalEventList =
  paths["/api/v1/goals/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type GoalEvent = GoalEventList["items"][number];

export async function listGoalEvents(id: number): Promise<GoalEvent[]> {
  return (await jsonRequest<GoalEventList>(`/api/v1/goals/${id}/events`)).items;
}
