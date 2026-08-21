// Notifications API — the recipient-scoped list and read-state actions.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { jsonRequest, voidRequest } from "./http";
import type { paths } from "./schema";

export type NotificationPage =
  paths["/api/v1/notifications"]["get"]["responses"]["200"]["content"]["application/json"];
export type NotificationItem = NotificationPage["items"][number];

type NotificationListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  wasSeen?: boolean;
};

export async function listNotifications(q: NotificationListQuery): Promise<NotificationPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.wasSeen != null) params.set("wasSeen", String(q.wasSeen));
  return jsonRequest<NotificationPage>(`/api/v1/notifications?${params.toString()}`);
}

export async function markNotificationSeen(id: number): Promise<void> {
  await voidRequest(`/api/v1/notifications/${id}/seen`, { method: "POST" });
}

export async function markNotificationUnseen(id: number): Promise<void> {
  await voidRequest(`/api/v1/notifications/${id}/unseen`, { method: "POST" });
}

export async function markAllNotificationsSeen(): Promise<void> {
  await voidRequest(`/api/v1/notifications/seen-all`, { method: "POST" });
}

export async function deleteNotification(id: number): Promise<void> {
  await voidRequest(`/api/v1/notifications/${id}`, { method: "DELETE" });
}
