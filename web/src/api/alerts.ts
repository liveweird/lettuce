// Alerts API — admin management plus the visible-alerts read.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

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

type VisibleAlertList =
  paths["/api/v1/alerts/visible"]["get"]["responses"]["200"]["content"]["application/json"];
export type VisibleAlert = VisibleAlertList["items"][number];

export async function getVisibleAlerts(): Promise<VisibleAlert[]> {
  const res = await authedFetch("/api/v1/alerts/visible");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as VisibleAlertList).items;
}
