// Impact log API — the per-employee accomplishment journal: CRUD and the event history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

export type ImpactEntryPage =
  paths["/api/v1/impact-log"]["get"]["responses"]["200"]["content"]["application/json"];
export type ImpactEntryListItem = ImpactEntryPage["items"][number];
export type ImpactEntryResponse =
  paths["/api/v1/impact-log/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type ImpactEntryBody =
  paths["/api/v1/impact-log"]["post"]["requestBody"]["content"]["application/json"];

export type ImpactLogListView = "own" | "managed" | "user";

type ImpactLogListQuery = {
  view: ImpactLogListView;
  page: number;
  pageSize: number;
  sort?: string;
  userName?: string;
  title?: string;
  /** Only valid with view=managed: widen from direct reports to the whole management chain. */
  includeIndirect?: boolean;
  /** Required with view=user (the HR auditor view): whose journal to list. */
  userId?: number;
};

export async function listImpactEntries(q: ImpactLogListQuery): Promise<ImpactEntryPage> {
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    userName: q.userName,
    title: q.title,
    includeIndirect: q.includeIndirect || undefined,
    userId: q.userId,
  });
  return jsonRequest<ImpactEntryPage>(`/api/v1/impact-log?${params}`);
}

// The owner is always the caller — no user id travels in the body.
export async function createImpactEntry(body: ImpactEntryBody): Promise<ImpactEntryResponse> {
  return jsonRequest<ImpactEntryResponse>("/api/v1/impact-log", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getImpactEntry(id: number): Promise<ImpactEntryResponse> {
  return jsonRequest<ImpactEntryResponse>(`/api/v1/impact-log/${id}`);
}

export async function updateImpactEntry(id: number, body: ImpactEntryBody): Promise<void> {
  await voidRequest(`/api/v1/impact-log/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteImpactEntry(id: number): Promise<void> {
  await voidRequest(`/api/v1/impact-log/${id}`, { method: "DELETE" });
}

type ImpactEntryEventList =
  paths["/api/v1/impact-log/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type ImpactEntryEvent = ImpactEntryEventList["items"][number];

export async function listImpactEntryEvents(id: number): Promise<ImpactEntryEvent[]> {
  return (await jsonRequest<ImpactEntryEventList>(`/api/v1/impact-log/${id}/events`)).items;
}
