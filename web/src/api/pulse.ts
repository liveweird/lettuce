// Pulse surveys API — cycles, responses, results, trend, and settings.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
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
  const res = await authedFetch("/api/v1/pulse-surveys/cycles");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as PulseCycleListResponse).items;
}

export async function createPulseCycle(body: {
  plannedOpenDate: string;
  plannedCloseDate: string;
}): Promise<PulseCycle> {
  const res = await authedFetch("/api/v1/pulse-surveys/cycles", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseCycle;
}

export async function updatePulseCycleDates(
  id: number,
  body: { plannedOpenDate: string; plannedCloseDate: string },
): Promise<void> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// The lifecycle transitions are POST action sub-resources, funneled through one helper.
async function pulseCycleTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
export const openPulseCycle = (id: number) => pulseCycleTransition(id, "open");
export const closePulseCycle = (id: number) => pulseCycleTransition(id, "close");
export const cancelPulseCycle = (id: number) => pulseCycleTransition(id, "cancel");

/** The caller's saved answers for an OPEN cycle — 404 before the first submit, 409 once closed. */
export async function getMyPulseResponse(cycleId: number): Promise<PulseMyResponse> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseMyResponse;
}

export async function submitMyPulseResponse(cycleId: number, body: PulseSubmitBody): Promise<void> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function getPulseResults(
  cycleId: number,
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseTeamResults> {
  const res = await authedFetch(
    `/api/v1/pulse-surveys/cycles/${cycleId}/results?teamId=${teamId}&mode=${mode}`,
  );
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseTeamResults;
}

export async function getPulseComments(
  cycleId: number,
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseCommentsResponse> {
  const res = await authedFetch(
    `/api/v1/pulse-surveys/cycles/${cycleId}/comments?teamId=${teamId}&mode=${mode}`,
  );
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseCommentsResponse;
}

export async function getPulseTrend(
  teamId: number,
  mode: PulseAggregationMode,
): Promise<PulseTrendResponse> {
  const res = await authedFetch(`/api/v1/pulse-surveys/trend?teamId=${teamId}&mode=${mode}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseTrendResponse;
}

/** Managers' per-person submitted yes/no over their monitored teams (HR: whole org). */
export async function getPulseParticipationStatus(cycleId: number): Promise<PulseParticipationStatus> {
  const res = await authedFetch(`/api/v1/pulse-surveys/cycles/${cycleId}/participation-status`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseParticipationStatus;
}

export async function getPulseVisibleTeams(): Promise<PulseVisibleTeams> {
  const res = await authedFetch("/api/v1/pulse-surveys/visible-teams");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseVisibleTeams;
}

export async function getPulseSettings(): Promise<PulseSettings> {
  const res = await authedFetch("/api/v1/pulse-surveys/settings");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PulseSettings;
}

export async function updatePulseSettings(body: PulseSettings): Promise<void> {
  const res = await authedFetch("/api/v1/pulse-surveys/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
