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
export type ShareBatchRequest = components["schemas"]["ShareBatchRequest"];
export type ShareBatchResponse = components["schemas"]["ShareBatchResponse"];
export type ShareBatchItem = components["schemas"]["ShareBatchItem"];

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

/** The server's per-call cap on documents in one batch (`MAX_BATCH_SHARE_RESOURCES`). */
export const MAX_BATCH_SHARE_RESOURCES = 200;

/** One batch call: many documents x many people, one request (the server's own rate-limit bucket). */
export async function createShareBatch(body: ShareBatchRequest): Promise<ShareBatchResponse> {
  return jsonRequest<ShareBatchResponse>("/api/v1/shares/batch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Splits ids into consecutive slices of at most `size`, order preserved. */
export function chunkIds(ids: readonly number[], size: number = MAX_BATCH_SHARE_RESOURCES): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/** The merged report of a chunked batch submission. */
export type ShareBatchOutcome = {
  items: ShareBatchItem[];
  created: number;
  alreadyShared: number;
  forbidden: number;
  notFound: number;
  /** The server batch ids of the chunks that created rows (a pure replay has none). */
  batchIds: string[];
  /**
   * Set when a chunk was rejected (a whole-request 403/404/429/5xx, a network error): the error and
   * the ids of the documents NOT submitted — the failed chunk and every later one — so the caller
   * can report the partial result and retry exactly those. Null when every chunk was answered.
   */
  failure: { error: unknown; resourceIds: number[] } | null;
};

/**
 * Shares `resourceIds` with `shareeIds` in sequential chunks of at most 200 documents (the server
 * cap; the batch route has its own 10/min per-caller bucket, so chunks are never fired in
 * parallel). A chunk the server rejects ends the run gracefully: the chunks already answered are
 * kept in the merged report and the rest come back as `failure.resourceIds` — never a thrown
 * error that would hide what was already created.
 */
export async function createShareBatches(
  resourceType: ShareableResourceType,
  resourceIds: readonly number[],
  shareeIds: readonly number[],
  expiresOn?: string,
): Promise<ShareBatchOutcome> {
  const outcome: ShareBatchOutcome = {
    items: [],
    created: 0,
    alreadyShared: 0,
    forbidden: 0,
    notFound: 0,
    batchIds: [],
    failure: null,
  };
  const chunks = chunkIds(resourceIds);
  for (let i = 0; i < chunks.length; i += 1) {
    try {
      const response = await createShareBatch({
        resourceType,
        resourceIds: chunks[i],
        shareeIds: [...shareeIds],
        expiresOn: expiresOn === "" ? undefined : expiresOn,
      });
      outcome.items.push(...response.items);
      outcome.created += response.created;
      outcome.alreadyShared += response.alreadyShared;
      outcome.forbidden += response.forbidden;
      outcome.notFound += response.notFound;
      if (response.batchId) outcome.batchIds.push(response.batchId);
    } catch (error) {
      outcome.failure = { error, resourceIds: chunks.slice(i).flat() };
      break;
    }
  }
  return outcome;
}
