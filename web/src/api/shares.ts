// Document-sharing API (v4.8.0) — share a document read-only with another person, list the
// shares of a document / with me / by me, withdraw one. Thin endpoint wrappers: transport
// (authedFetch/ApiError) in ./http. The server derives each share's `link` (the document's view
// path) and the status; the client never rebuilds either.

import { buildQuery, jsonRequest, voidRequest } from "./http";
import type { components, paths } from "./schema";

export type ShareableResourceType = components["schemas"]["ShareableResourceType"];
export type ShareStatus = components["schemas"]["ShareStatus"];
export type ShareRequest = paths["/api/v1/shares"]["post"]["requestBody"]["content"]["application/json"];
export type ShareResponse = components["schemas"]["ShareResponse"];
type SharePage = components["schemas"]["SharePage"];

type ShareListView = "withMe" | "byMe" | "document";

type ShareListQuery = {
  view?: ShareListView;
  /** Required with view=document (and optional equality filter on the other views). */
  resourceType?: ShareableResourceType;
  /** Accepted only with, and required by, view=document. */
  resourceId?: number;
  status?: ShareStatus;
  page?: number;
  pageSize?: number;
  /** `id` | `createdAt` | `expiresOn`, `-` prefix for descending (server default `-createdAt`). */
  sort?: string;
};

export async function listShares(q: ShareListQuery = {}): Promise<SharePage> {
  const params = buildQuery({
    view: q.view,
    resourceType: q.resourceType,
    resourceId: q.resourceId,
    status: q.status,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
  });
  return jsonRequest<SharePage>(`/api/v1/shares${params ? `?${params}` : ""}`);
}

// A document is shared with a handful of people; the page bound only keeps a pathological one
// from looping (10 x 100 rows).
const MAX_DOCUMENT_SHARE_PAGES = 10;

/**
 * Every share the caller may see of ONE document (the author sees all rows, any other own-right
 * holder only their own), paging until the server total is reached — the listAllUsers idiom,
 * bounded.
 */
export async function listAllDocumentShares(
  resourceType: ShareableResourceType,
  resourceId: number,
): Promise<ShareResponse[]> {
  const items: ShareResponse[] = [];
  for (let page = 1; page <= MAX_DOCUMENT_SHARE_PAGES; page += 1) {
    const result = await listShares({ view: "document", resourceType, resourceId, page, pageSize: 100 });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
  }
  return items;
}

/** One sharee per call — the dialog submits sequentially and itemizes failures. */
export async function createShare(body: ShareRequest): Promise<ShareResponse> {
  return jsonRequest<ShareResponse>("/api/v1/shares", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getShare(id: number): Promise<ShareResponse> {
  return jsonRequest<ShareResponse>(`/api/v1/shares/${id}`);
}

/** Terminal: the sharer always, the document's author while they can still read it. */
export async function withdrawShare(id: number): Promise<void> {
  await voidRequest(`/api/v1/shares/${id}/withdraw`, { method: "POST" });
}
