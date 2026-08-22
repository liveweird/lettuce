// Feedbacks API — CRUD, lifecycle transitions, and the event history.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

export type FeedbackPage =
  paths["/api/v1/feedbacks"]["get"]["responses"]["200"]["content"]["application/json"];

export type FeedbackVisibility =
  | "PROVIDER_SUBJECT"
  | "PROVIDER_REQUESTER"
  | "PROVIDER_REQUESTER_SUBJECT"
  | "PUBLIC";
export type FeedbackStatus = "REQUESTED" | "DRAFT" | "SENT" | "WITHDRAWN" | "REJECTED";

export type FeedbackListView = "received" | "provided" | "team" | "user" | "kudos";

type FeedbackListQuery = {
  view: FeedbackListView;
  page: number;
  pageSize: number;
  sort?: string;
  requesterName?: string;
  subjectName?: string;
  providerName?: string;
  providerId?: number;
  subjectId?: number;
  visibility?: FeedbackVisibility;
  status?: FeedbackStatus;
  lastModifiedGte?: number;
  /** Only valid with view=team: widen the subject scope from direct reports to the whole management chain. */
  includeIndirect?: boolean;
  /** Required with view=user (the HR auditor view): whose records to list. */
  userId?: number;
};

export async function listFeedbacks(q: FeedbackListQuery): Promise<FeedbackPage> {
  const params = buildQuery({
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    requesterName: q.requesterName,
    subjectName: q.subjectName,
    providerName: q.providerName,
    providerId: q.providerId,
    subjectId: q.subjectId,
    visibility: q.visibility,
    status: q.status,
    "lastModified[gte]": q.lastModifiedGte,
    includeIndirect: q.includeIndirect || undefined,
    userId: q.userId,
  });
  return jsonRequest<FeedbackPage>(`/api/v1/feedbacks?${params}`);
}

type CreateFeedbackBody =
  paths["/api/v1/feedbacks"]["post"]["requestBody"]["content"]["application/json"];
type CreateFeedbackResponse =
  paths["/api/v1/feedbacks"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createFeedback(req: CreateFeedbackBody): Promise<CreateFeedbackResponse> {
  return jsonRequest<CreateFeedbackResponse>("/api/v1/feedbacks", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export type DuplicateCheckResponse =
  paths["/api/v1/feedbacks/duplicate-check"]["get"]["responses"]["200"]["content"]["application/json"];

// The no-duplicate early check backing the create screens' warning (see FeedbackForm/create pages).
export async function checkFeedbackDuplicate(params: {
  subjectId: number;
  providerId: number;
  requesterId?: number;
}): Promise<DuplicateCheckResponse> {
  const query = buildQuery({
    subjectId: params.subjectId,
    providerId: params.providerId,
    requesterId: params.requesterId,
  });
  return jsonRequest<DuplicateCheckResponse>(`/api/v1/feedbacks/duplicate-check?${query}`);
}

export type FeedbackResponse =
  paths["/api/v1/feedbacks/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateFeedbackBody =
  paths["/api/v1/feedbacks/{id}"]["put"]["requestBody"]["content"]["application/json"];

export async function getFeedback(id: number): Promise<FeedbackResponse> {
  return jsonRequest<FeedbackResponse>(`/api/v1/feedbacks/${id}`);
}

export async function updateFeedback(id: number, body: UpdateFeedbackBody): Promise<void> {
  await voidRequest(`/api/v1/feedbacks/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteFeedback(id: number): Promise<void> {
  await voidRequest(`/api/v1/feedbacks/${id}`, { method: "DELETE" });
}

// Lifecycle transitions are POST action sub-resources (bodyless). An invalid transition from the
// current status returns 409, surfaced as an ApiError like any other failure.
async function feedbackTransition(id: number, action: string): Promise<void> {
  await voidRequest(`/api/v1/feedbacks/${id}/${action}`, { method: "POST" });
}

export const sendFeedback = (id: number) => feedbackTransition(id, "send");
export const withdrawFeedback = (id: number) => feedbackTransition(id, "withdraw");
export const rejectFeedback = (id: number) => feedbackTransition(id, "reject");
export const pickUpFeedback = (id: number) => feedbackTransition(id, "pick-up");

type FeedbackEventList =
  paths["/api/v1/feedbacks/{id}/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type FeedbackEvent = FeedbackEventList["items"][number];

export async function listFeedbackEvents(id: number): Promise<FeedbackEvent[]> {
  return (await jsonRequest<FeedbackEventList>(`/api/v1/feedbacks/${id}/events`)).items;
}
