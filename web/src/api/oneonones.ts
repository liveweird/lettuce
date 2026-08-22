// 1:1 meetings API — CRUD, events, and the action-item history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

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
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    managerName: q.managerName,
    subordinateName: q.subordinateName,
    "meetingDate[gte]": q.meetingDateGte,
    "meetingDate[lte]": q.meetingDateLte,
    includeIndirect: q.includeIndirect || undefined,
    counterpartId: q.counterpartId,
    userId: q.userId,
  });
  return jsonRequest<OneOnOnePage>(`/api/v1/one-on-ones?${params}`);
}

export type CreateOneOnOneBody =
  paths["/api/v1/one-on-ones"]["post"]["requestBody"]["content"]["application/json"];
export type OneOnOneResponse =
  paths["/api/v1/one-on-ones/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type UpdateOneOnOneBody =
  paths["/api/v1/one-on-ones/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function createOneOnOne(req: CreateOneOnOneBody): Promise<OneOnOneResponse> {
  return jsonRequest<OneOnOneResponse>("/api/v1/one-on-ones", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getOneOnOne(id: number): Promise<OneOnOneResponse> {
  return jsonRequest<OneOnOneResponse>(`/api/v1/one-on-ones/${id}`);
}

export async function updateOneOnOne(id: number, body: UpdateOneOnOneBody): Promise<void> {
  await voidRequest(`/api/v1/one-on-ones/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteOneOnOne(id: number): Promise<void> {
  await voidRequest(`/api/v1/one-on-ones/${id}`, { method: "DELETE" });
}

type OneOnOneEventList =
  paths["/api/v1/one-on-ones/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type OneOnOneEvent = OneOnOneEventList["items"][number];

export async function listOneOnOneEvents(id: number): Promise<OneOnOneEvent[]> {
  return (await jsonRequest<OneOnOneEventList>(`/api/v1/one-on-ones/${id}/events`)).items;
}

type ActionItemHistoryList =
  paths["/api/v1/one-on-ones/action-items/{id}/history"]["get"]["responses"]["200"]["content"]["application/json"];
export type ActionItemHistoryEntry = ActionItemHistoryList["items"][number];

export async function getActionItemHistory(id: number): Promise<ActionItemHistoryEntry[]> {
  return (await jsonRequest<ActionItemHistoryList>(`/api/v1/one-on-ones/action-items/${id}/history`)).items;
}
