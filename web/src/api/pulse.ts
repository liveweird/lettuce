// Pulse surveys API — cycles, responses, results, trend, and settings.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { jsonRequest, voidRequest } from "./http";
import type { components, paths } from "./schema";

export type PulseCycle = components["schemas"]["PulseCycle"];
export type PulseCycleStatus = PulseCycle["status"];
export type PulseScaleAnswer = components["schemas"]["PulseScaleAnswer"];
export type PulseSubmitBody = components["schemas"]["PulseResponseSubmitRequest"];
export type PulseMyResponse = components["schemas"]["PulseMyResponse"];
export type PulseTeamResults = components["schemas"]["PulseTeamResults"];
export type PulseDriverResult = components["schemas"]["PulseDriverResult"];
export type PulseAggregationMode = components["schemas"]["PulseAggregationMode"];
export type PulseTrendResponse = components["schemas"]["PulseTrendResponse"];
export type PulseTrendPoint = components["schemas"]["PulseTrendPoint"];
export type PulseCommentsResponse = components["schemas"]["PulseCommentsResponse"];
export type PulseParticipationStatus = components["schemas"]["PulseParticipationStatusResponse"];
export type PulseVisibleTeams = components["schemas"]["PulseVisibleTeams"];

export type PulseSettings = components["schemas"]["PulseSettings"];
type PulseCycleListResponse =
  paths["/api/v1/pulse-surveys/cycles"]["get"]["responses"]["200"]["content"]["application/json"];

/** All cycles, newest first (unpaged registry). Admin rows carry the participation counts. */
export async function listPulseCycles(): Promise<PulseCycle[]> {
  return (await jsonRequest<PulseCycleListResponse>("/api/v1/pulse-surveys/cycles")).items;
}

export async function createPulseCycle(body: {
  plannedOpenDate: string;
  plannedCloseDate: string;
}): Promise<PulseCycle> {
  return jsonRequest<PulseCycle>("/api/v1/pulse-surveys/cycles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updatePulseCycleDates(
  id: number,
  body: { plannedOpenDate: string; plannedCloseDate: string },
): Promise<void> {
  await voidRequest(`/api/v1/pulse-surveys/cycles/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// The lifecycle transitions are POST action sub-resources, funneled through one helper.
async function pulseCycleTransition(id: number, action: string): Promise<void> {
  await voidRequest(`/api/v1/pulse-surveys/cycles/${id}/${action}`, { method: "POST" });
}
export const openPulseCycle = (id: number) => pulseCycleTransition(id, "open");
export const closePulseCycle = (id: number) => pulseCycleTransition(id, "close");
export const cancelPulseCycle = (id: number) => pulseCycleTransition(id, "cancel");

/** The caller's saved answers for an OPEN cycle — 404 before the first submit, 409 once closed. */
export async function getMyPulseResponse(cycleId: number): Promise<PulseMyResponse> {
  return jsonRequest<PulseMyResponse>(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`);
}

export async function submitMyPulseResponse(cycleId: number, body: PulseSubmitBody): Promise<void> {
  await voidRequest(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function getPulseResults(
  cycleId: number,
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseTeamResults> {
  return jsonRequest<PulseTeamResults>(
    `/api/v1/pulse-surveys/cycles/${cycleId}/results?teamId=${teamId}&mode=${mode}`,
  );
}

export async function getPulseComments(
  cycleId: number,
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseCommentsResponse> {
  return jsonRequest<PulseCommentsResponse>(
    `/api/v1/pulse-surveys/cycles/${cycleId}/comments?teamId=${teamId}&mode=${mode}`,
  );
}

export async function getPulseTrend(
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseTrendResponse> {
  return jsonRequest<PulseTrendResponse>(`/api/v1/pulse-surveys/trend?teamId=${teamId}&mode=${mode}`);
}

/** Managers' per-person submitted yes/no over their monitored teams (HR: whole org). */
export async function getPulseParticipationStatus(cycleId: number): Promise<PulseParticipationStatus> {
  return jsonRequest<PulseParticipationStatus>(`/api/v1/pulse-surveys/cycles/${cycleId}/participation-status`);
}

export async function getPulseVisibleTeams(): Promise<PulseVisibleTeams> {
  return jsonRequest<PulseVisibleTeams>("/api/v1/pulse-surveys/visible-teams");
}

export async function getPulseSettings(): Promise<PulseSettings> {
  return jsonRequest<PulseSettings>("/api/v1/pulse-surveys/settings");
}

export async function updatePulseSettings(body: PulseSettings): Promise<void> {
  await voidRequest("/api/v1/pulse-surveys/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
