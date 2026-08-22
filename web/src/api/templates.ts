// Templates API.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
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
  const params = buildQuery({ page: q.page, pageSize: q.pageSize, sort: q.sort, name: q.name });
  return jsonRequest<TemplatePage>(`/api/v1/templates?${params}`);
}

type CreateTemplateBody =
  paths["/api/v1/templates"]["post"]["requestBody"]["content"]["application/json"];
type CreateTemplateResponse =
  paths["/api/v1/templates"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createTemplate(req: CreateTemplateBody): Promise<CreateTemplateResponse> {
  return jsonRequest<CreateTemplateResponse>("/api/v1/templates", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export type TemplateResponse =
  paths["/api/v1/templates/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateTemplateBody =
  paths["/api/v1/templates/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getTemplate(id: number): Promise<TemplateResponse> {
  return jsonRequest<TemplateResponse>(`/api/v1/templates/${id}`);
}

export async function updateTemplate(id: number, body: UpdateTemplateBody): Promise<void> {
  await voidRequest(`/api/v1/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteTemplate(id: number): Promise<void> {
  await voidRequest(`/api/v1/templates/${id}`, { method: "DELETE" });
}
