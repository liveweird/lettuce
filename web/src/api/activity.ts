// Activity-log API (v4.9.0) — the chronological log of what a person DID: one row per history
// event they authored, the shares they created/withdrew, their days-off and career actions and
// their sign-ins. Thin endpoint wrapper: transport in ./http. Hidden rows (a chain viewer's) are
// never sent, so `total` is exact for the viewer.

import { buildQuery, jsonRequest } from "./http";
import type { components } from "./schema";

export type ActivityArea = components["schemas"]["ActivityArea"];
export type ActivityEntry = components["schemas"]["ActivityEntry"];
type ActivityPage = components["schemas"]["ActivityPage"];

type ActivityQuery = {
  page: number;
  pageSize: number;
  /** `createdAt` | `-createdAt` — the only sortable field (server default `-createdAt`). */
  sort?: string;
  area?: ActivityArea;
  /** Inclusive epoch-millisecond bounds on the event moment (400 when gte > lte). */
  createdAtGte?: number;
  createdAtLte?: number;
};

export async function listActivity(userId: number, q: ActivityQuery): Promise<ActivityPage> {
  const params = buildQuery({
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    area: q.area,
    "createdAt[gte]": q.createdAtGte,
    "createdAt[lte]": q.createdAtLte,
  });
  return jsonRequest<ActivityPage>(`/api/v1/users/${userId}/activity?${params}`);
}
