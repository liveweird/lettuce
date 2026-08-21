// Days off API — requests, corrections, budgets, the calendar, and public holidays.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { paths } from "./schema";

export type DaysOffPage =
  paths["/api/v1/days-off"]["get"]["responses"]["200"]["content"]["application/json"];
export type DaysOffListItem = DaysOffPage["items"][number];
export type DaysOffResponse =
  paths["/api/v1/days-off/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type DaysOffStatus = DaysOffResponse["status"];
export type DaysOffType = DaysOffResponse["type"];

export type DaysOffListView = "own" | "managed" | "user";

type DaysOffListQuery = {
  view: DaysOffListView;
  page: number;
  pageSize: number;
  sort?: string;
  userName?: string;
  type?: DaysOffType;
  status?: DaysOffStatus;
  startDateGte?: string;
  startDateLte?: string;
  /** Required with view=user (the HR auditor view); a pin-filter with view=managed. */
  userId?: number;
};

export async function listDaysOff(q: DaysOffListQuery): Promise<DaysOffPage> {
  const params = new URLSearchParams();
  params.set("view", q.view);
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.userName) params.set("userName", q.userName);
  if (q.type) params.set("type", q.type);
  if (q.status) params.set("status", q.status);
  if (q.startDateGte) params.set("startDate[gte]", q.startDateGte);
  if (q.startDateLte) params.set("startDate[lte]", q.startDateLte);
  if (q.userId != null) params.set("userId", String(q.userId));
  const res = await authedFetch(`/api/v1/days-off?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffPage;
}

export type DaysOffCreateBody =
  paths["/api/v1/days-off"]["post"]["requestBody"]["content"]["application/json"];

// Without userId: the caller's own request, entering REQUESTED. With userId (v2.29.0): a
// direct manager records the entry on that report's behalf, born ACCEPTED with the caller as
// resolver. Overlap and paid-budget violations are 409 either way (the overlap's
// ProblemDetail.instance points at the conflicting request).
export async function createDaysOff(body: DaysOffCreateBody): Promise<DaysOffResponse> {
  const res = await authedFetch("/api/v1/days-off", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffResponse;
}

// Lifecycle actions: accept/reject are the direct manager's resolution of a REQUESTED request;
// cancel is the owner's withdrawal (REQUESTED anytime, ACCEPTED only before the start date).
// A request not in the action's source status returns 409.
async function daysOffTransition(id: number, action: string): Promise<void> {
  const res = await authedFetch(`/api/v1/days-off/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export const acceptDaysOff = (id: number) => daysOffTransition(id, "accept");
export const rejectDaysOff = (id: number) => daysOffTransition(id, "reject");
export const cancelDaysOff = (id: number) => daysOffTransition(id, "cancel");

export type DaysOffCalendarResponse =
  paths["/api/v1/days-off/calendar"]["get"]["responses"]["200"]["content"]["application/json"];
type DaysOffCalendarUser = DaysOffCalendarResponse["users"][number];
export type DaysOffCalendarEntry = DaysOffCalendarUser["entries"][number];
export type DaysOffCalendarScope = "member" | "managed";

/** The month's leave-planner payload (unpaged): the scope's users with their marked days
 * plus the month's public holidays. */
export async function getDaysOffCalendar(
  month: string,
  scope: DaysOffCalendarScope,
): Promise<DaysOffCalendarResponse> {
  const res = await authedFetch(`/api/v1/days-off/calendar?month=${month}&scope=${scope}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffCalendarResponse;
}

export type DaysOffBudget =
  paths["/api/v1/days-off/budgets"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type DaysOffBudgetView = "own" | "managed";

/** Per-user paid-days budget rows for a calendar year (own = one row, managed = direct reports). */
export async function listDaysOffBudgets(
  view: DaysOffBudgetView,
  year: number,
): Promise<DaysOffBudget[]> {
  const res = await authedFetch(`/api/v1/days-off/budgets?view=${view}&year=${year}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: DaysOffBudget[] }).items;
}

export type DaysOffCorrection =
  paths["/api/v1/days-off/corrections"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type DaysOffCorrectionWrite =
  paths["/api/v1/days-off/corrections"]["post"]["requestBody"]["content"]["application/json"];
export type DaysOffCorrectionOperation = DaysOffCorrection["operation"];

/** A user's active budget corrections, newest first — unpaged (intrinsically few). */
export async function listDaysOffCorrections(userId: number, year?: number): Promise<DaysOffCorrection[]> {
  const params = new URLSearchParams({ userId: String(userId) });
  if (year != null) params.set("year", String(year));
  const res = await authedFetch(`/api/v1/days-off/corrections?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: DaysOffCorrection[] }).items;
}

// Current-direct-manager only; the subordinate is notified.
export async function createDaysOffCorrection(body: DaysOffCorrectionWrite): Promise<DaysOffCorrection> {
  const res = await authedFetch("/api/v1/days-off/corrections", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as DaysOffCorrection;
}

// The target user is immutable (the payload's userId is ignored server-side).
export async function updateDaysOffCorrection(id: number, body: DaysOffCorrectionWrite): Promise<void> {
  const res = await authedFetch(`/api/v1/days-off/corrections/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

// Soft delete — the correction drops out of the list and the budget math.
export async function deleteDaysOffCorrection(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/days-off/corrections/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export type PublicHoliday =
  paths["/api/v1/public-holidays"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type PublicHolidayCreateBody =
  paths["/api/v1/public-holidays"]["post"]["requestBody"]["content"]["application/json"];

/** The whole global registry, oldest date first — unpaged (the review-periods shape). */
export async function listPublicHolidays(): Promise<PublicHoliday[]> {
  const res = await authedFetch("/api/v1/public-holidays");
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as { items: PublicHoliday[] }).items;
}

// ADMIN-only; a duplicate date is 409.
export async function createPublicHoliday(body: PublicHolidayCreateBody): Promise<PublicHoliday> {
  const res = await authedFetch("/api/v1/public-holidays", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as PublicHoliday;
}

// ADMIN-only; hard delete (existing request costs stay frozen).
export async function deletePublicHoliday(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/public-holidays/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
