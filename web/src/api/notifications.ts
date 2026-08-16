// Notifications API — the recipient-scoped list and read-state actions.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
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
  const res = await authedFetch(`/api/v1/notifications?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as NotificationPage;
}

export async function markNotificationSeen(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/${id}/seen`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function markNotificationUnseen(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/${id}/unseen`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function markAllNotificationsSeen(): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/seen-all`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}

export async function deleteNotification(id: number): Promise<void> {
  const res = await authedFetch(`/api/v1/notifications/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
