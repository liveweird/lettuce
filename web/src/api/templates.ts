// Templates API.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

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
