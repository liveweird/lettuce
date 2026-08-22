// Alerts API — admin management plus the visible-alerts read.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
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
  const params = buildQuery({
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    title: q.title,
    isActive: q.isActive,
  });
  return jsonRequest<AlertPage>(`/api/v1/alerts?${params}`);
}

export type CreateAlertBody =
  paths["/api/v1/alerts"]["post"]["requestBody"]["content"]["application/json"];
type CreateAlertResponse =
  paths["/api/v1/alerts"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createAlert(req: CreateAlertBody): Promise<CreateAlertResponse> {
  return jsonRequest<CreateAlertResponse>("/api/v1/alerts", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export type AlertResponse =
  paths["/api/v1/alerts/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateAlertBody =
  paths["/api/v1/alerts/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getAlert(id: number): Promise<AlertResponse> {
  return jsonRequest<AlertResponse>(`/api/v1/alerts/${id}`);
}

export async function updateAlert(id: number, body: UpdateAlertBody): Promise<void> {
  await voidRequest(`/api/v1/alerts/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteAlert(id: number): Promise<void> {
  await voidRequest(`/api/v1/alerts/${id}`, { method: "DELETE" });
}

type VisibleAlertList =
  paths["/api/v1/alerts/visible"]["get"]["responses"]["200"]["content"]["application/json"];
export type VisibleAlert = VisibleAlertList["items"][number];

export async function getVisibleAlerts(): Promise<VisibleAlert[]> {
  return (await jsonRequest<VisibleAlertList>("/api/v1/alerts/visible")).items;
}
