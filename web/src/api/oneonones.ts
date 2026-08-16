// 1:1 meetings API — CRUD, events, and the action-item history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
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

type OneOnOneEventList =
  paths["/api/v1/one-on-ones/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type OneOnOneEvent = OneOnOneEventList["items"][number];

export async function listOneOnOneEvents(id: number): Promise<OneOnOneEvent[]> {
  const res = await authedFetch(`/api/v1/one-on-ones/${id}/events`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as OneOnOneEventList).items;
}

type ActionItemHistoryList =
  paths["/api/v1/one-on-ones/action-items/{id}/history"]["get"]["responses"]["200"]["content"]["application/json"];
export type ActionItemHistoryEntry = ActionItemHistoryList["items"][number];

export async function getActionItemHistory(id: number): Promise<ActionItemHistoryEntry[]> {
  const res = await authedFetch(`/api/v1/one-on-ones/action-items/${id}/history`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as ActionItemHistoryList).items;
}
