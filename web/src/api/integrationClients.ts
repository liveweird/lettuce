// Integration clients API (admin key management for the read-only GraphQL integration API).
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

type IntegrationClientList =
  paths["/api/v1/integration-clients"]["get"]["responses"]["200"]["content"]["application/json"];
export type IntegrationClient = IntegrationClientList["items"][number];
export type IntegrationClientCreated =
  paths["/api/v1/integration-clients"]["post"]["responses"]["201"]["content"]["application/json"];

export async function listIntegrationClients(): Promise<IntegrationClient[]> {
  return (await jsonRequest<IntegrationClientList>("/api/v1/integration-clients")).items;
}

export async function createIntegrationClient(name: string): Promise<IntegrationClientCreated> {
  return jsonRequest<IntegrationClientCreated>("/api/v1/integration-clients", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function revokeIntegrationClient(id: number): Promise<void> {
  await voidRequest(`/api/v1/integration-clients/${id}/revoke`, { method: "POST" });
}
