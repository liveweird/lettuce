// Days off API — requests, corrections, budgets, the calendar, and public holidays.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
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
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    userName: q.userName,
    type: q.type,
    status: q.status,
    "startDate[gte]": q.startDateGte,
    "startDate[lte]": q.startDateLte,
    userId: q.userId,
  });
  return jsonRequest<DaysOffPage>(`/api/v1/days-off?${params}`);
}

export type DaysOffCreateBody =
  paths["/api/v1/days-off"]["post"]["requestBody"]["content"]["application/json"];

// Without userId: the caller's own request, entering REQUESTED. With userId (v2.29.0): a
// direct manager records the entry on that report's behalf, born ACCEPTED with the caller as
// resolver. Overlap and paid-budget violations are 409 either way (the overlap's
// ProblemDetail.instance points at the conflicting request).
export async function createDaysOff(body: DaysOffCreateBody): Promise<DaysOffResponse> {
  return jsonRequest<DaysOffResponse>("/api/v1/days-off", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Lifecycle actions: accept/reject are the direct manager's resolution of a REQUESTED request;
// cancel is the owner's withdrawal (REQUESTED anytime, ACCEPTED only before the start date).
// A request not in the action's source status returns 409.
async function daysOffTransition(id: number, action: string): Promise<void> {
  await voidRequest(`/api/v1/days-off/${id}/${action}`, { method: "POST" });
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
  return jsonRequest<DaysOffCalendarResponse>(`/api/v1/days-off/calendar?month=${month}&scope=${scope}`);
}

export type DaysOffBudget =
  paths["/api/v1/days-off/budgets"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type DaysOffBudgetView = "own" | "managed";

/** Per-user paid-days budget rows for a calendar year (own = one row, managed = direct reports). */
export async function listDaysOffBudgets(
  view: DaysOffBudgetView,
  year: number,
): Promise<DaysOffBudget[]> {
  return (await jsonRequest<{ items: DaysOffBudget[] }>(`/api/v1/days-off/budgets?view=${view}&year=${year}`)).items;
}

export type DaysOffCorrection =
  paths["/api/v1/days-off/corrections"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type DaysOffCorrectionWrite =
  paths["/api/v1/days-off/corrections"]["post"]["requestBody"]["content"]["application/json"];
export type DaysOffCorrectionOperation = DaysOffCorrection["operation"];

/** A user's active budget corrections, newest first — unpaged (intrinsically few). */
export async function listDaysOffCorrections(userId: number, year?: number): Promise<DaysOffCorrection[]> {
  const params = buildQuery({ userId, year });
  return (await jsonRequest<{ items: DaysOffCorrection[] }>(`/api/v1/days-off/corrections?${params}`)).items;
}

// Current-direct-manager only; the subordinate is notified.
export async function createDaysOffCorrection(body: DaysOffCorrectionWrite): Promise<DaysOffCorrection> {
  return jsonRequest<DaysOffCorrection>("/api/v1/days-off/corrections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// The target user is immutable (the payload's userId is ignored server-side).
export async function updateDaysOffCorrection(id: number, body: DaysOffCorrectionWrite): Promise<void> {
  await voidRequest(`/api/v1/days-off/corrections/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// Soft delete — the correction drops out of the list and the budget math.
export async function deleteDaysOffCorrection(id: number): Promise<void> {
  await voidRequest(`/api/v1/days-off/corrections/${id}`, { method: "DELETE" });
}

export type PublicHoliday =
  paths["/api/v1/public-holidays"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type PublicHolidayCreateBody =
  paths["/api/v1/public-holidays"]["post"]["requestBody"]["content"]["application/json"];

/** The whole global registry, oldest date first — unpaged (the review-periods shape). */
export async function listPublicHolidays(): Promise<PublicHoliday[]> {
  return (await jsonRequest<{ items: PublicHoliday[] }>("/api/v1/public-holidays")).items;
}

// ADMIN-only; a duplicate date is 409.
export async function createPublicHoliday(body: PublicHolidayCreateBody): Promise<PublicHoliday> {
  return jsonRequest<PublicHoliday>("/api/v1/public-holidays", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ADMIN-only; hard delete (existing request costs stay frozen).
export async function deletePublicHoliday(id: number): Promise<void> {
  await voidRequest(`/api/v1/public-holidays/${id}`, { method: "DELETE" });
}
