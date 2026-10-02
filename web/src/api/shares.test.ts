import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./http";
import {
  chunkIds,
  createShare,
  createShareBatch,
  createShareBatches,
  getShare,
  listAllDocumentShares,
  listShares,
  MAX_BATCH_SHARE_RESOURCES,
  withdrawShare,
} from "./shares";
import { documentSharesKey, invalidateShares } from "../utils/shareQueries";
import { isShareLapse } from "../utils/shareLapse";
import { jsonResponse } from "../test/http";

const PAGE = { items: [], page: 1, pageSize: 100, total: 0 };

describe("shares API wrappers", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("listShares builds the query string (document view with its filters, bare call without one)", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, PAGE)));
    vi.stubGlobal("fetch", fetchMock);

    await listShares({ view: "document", resourceType: "GOAL", resourceId: 5, pageSize: 100 });
    await listShares();
    await listShares({ view: "withMe", status: "ACTIVE", sort: "-createdAt", page: 2, pageSize: 20 });

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls[0]).toBe("/api/v1/shares?view=document&resourceType=GOAL&resourceId=5&pageSize=100");
    expect(urls[1]).toBe("/api/v1/shares");
    expect(urls[2]).toBe("/api/v1/shares?view=withMe&status=ACTIVE&page=2&pageSize=20&sort=-createdAt");
  });

  test("createShare POSTs the body, getShare reads one, withdrawShare POSTs the terminal action", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" && String(_url).endsWith("/withdraw") ? new Response(null, { status: 204 }) : jsonResponse(201, { id: 9 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createShare({ resourceType: "FEEDBACK", resourceId: 3, shareeId: 8, expiresOn: "2099-01-01" });
    await getShare(9);
    await withdrawShare(9);

    const [create, get, withdraw] = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    expect(create[0]).toBe("/api/v1/shares");
    expect(create[1]?.method).toBe("POST");
    expect(JSON.parse(String(create[1]?.body))).toEqual({
      resourceType: "FEEDBACK",
      resourceId: 3,
      shareeId: 8,
      expiresOn: "2099-01-01",
    });
    expect(get[0]).toBe("/api/v1/shares/9");
    expect(withdraw[0]).toBe("/api/v1/shares/9/withdraw");
    expect(withdraw[1]?.method).toBe("POST");
  });

  test("listAllDocumentShares pages until the total is reached", async () => {
    const row = (id: number) => ({ id });
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        jsonResponse(
          200,
          String(url).includes("page=2")
            ? { items: [row(3)], page: 2, pageSize: 100, total: 3 }
            : { items: [row(1), row(2)], page: 1, pageSize: 100, total: 3 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const all = await listAllDocumentShares("GOAL", 5);

    expect(all.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "/api/v1/shares?view=document&resourceType=GOAL&resourceId=5&page=2&pageSize=100",
    );
  });

  test("an error answer surfaces as ApiError with the problem detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(409, { title: "Conflict", status: 409, detail: "dup", instance: "/api/v1/shares/4" }))),
    );
    const err = await createShare({ resourceType: "GOAL", resourceId: 1, shareeId: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).instance).toBe("/api/v1/shares/4");
  });
});

type BatchBody = { resourceType: string; resourceIds: number[]; shareeIds: number[]; expiresOn?: string };

/** A fetch mock answering each batch POST with one CREATED item per (resource, sharee) pair. */
function batchFetch(opts: { failOnCall?: number; status?: number } = {}) {
  let call = 0;
  return vi.fn((_url: string, init?: RequestInit) => {
    call += 1;
    if (call === opts.failOnCall) {
      return Promise.resolve(jsonResponse(opts.status ?? 429, { title: "Too Many Requests", status: opts.status ?? 429 }));
    }
    const body = JSON.parse(String(init?.body)) as BatchBody;
    const items = body.resourceIds.flatMap((resourceId) =>
      body.shareeIds.map((shareeId) => ({ resourceId, shareeId, status: "CREATED", shareId: resourceId * 100 + shareeId })),
    );
    return Promise.resolve(
      jsonResponse(200, { batchId: `batch-${call}`, items, created: items.length, alreadyShared: 0, forbidden: 0, notFound: 0 }),
    );
  });
}

describe("batch share wrappers", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("chunkIds slices in order into pieces of at most the size", () => {
    expect(chunkIds([])).toEqual([]);
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(MAX_BATCH_SHARE_RESOURCES).toBe(200);
  });

  test("createShareBatch POSTs the body to /shares/batch", async () => {
    const fetchMock = batchFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await createShareBatch({ resourceType: "PERFORMANCE_REVIEW", resourceIds: [1], shareeIds: [8], expiresOn: "2099-01-01" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/shares/batch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      resourceType: "PERFORMANCE_REVIEW",
      resourceIds: [1],
      shareeIds: [8],
      expiresOn: "2099-01-01",
    });
    expect(res.created).toBe(1);
  });

  test("450 documents go out as three sequential calls of 200/200/50 and the reports merge", async () => {
    const fetchMock = batchFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);

    const out = await createShareBatches("PERFORMANCE_REVIEW", ids, [8, 9], "2099-01-01");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => JSON.parse(String(init.body)) as BatchBody,
    );
    expect(bodies.map((b) => b.resourceIds.length)).toEqual([200, 200, 50]);
    expect(bodies.flatMap((b) => b.resourceIds)).toEqual(ids);
    expect(bodies.every((b) => b.shareeIds.join() === "8,9" && b.expiresOn === "2099-01-01")).toBe(true);
    expect(out.created).toBe(900);
    expect(out.items).toHaveLength(900);
    expect(out.batchIds).toEqual(["batch-1", "batch-2", "batch-3"]);
    expect(out.failure).toBeNull();
  });

  test("a blank end date is omitted from the body", async () => {
    const fetchMock = batchFetch();
    vi.stubGlobal("fetch", fetchMock);
    await createShareBatches("PERFORMANCE_REVIEW", [1], [8], "");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("expiresOn");
  });

  test("a 429 on a later chunk keeps what was created and returns the unsent ids", async () => {
    const fetchMock = batchFetch({ failOnCall: 2, status: 429 });
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);

    const out = await createShareBatches("PERFORMANCE_REVIEW", ids, [8]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.created).toBe(200);
    expect(out.batchIds).toEqual(["batch-1"]);
    expect(out.failure?.error).toBeInstanceOf(ApiError);
    expect((out.failure?.error as ApiError).status).toBe(429);
    expect(out.failure?.resourceIds).toEqual(ids.slice(200));
  });

  test("a whole-request 403 on the first chunk reports every id unsent and does not throw", async () => {
    vi.stubGlobal("fetch", batchFetch({ failOnCall: 1, status: 403 }));
    const out = await createShareBatches("PERFORMANCE_REVIEW", [4, 5], [8]);
    expect(out.created).toBe(0);
    expect(out.items).toEqual([]);
    expect((out.failure?.error as ApiError).status).toBe(403);
    expect(out.failure?.resourceIds).toEqual([4, 5]);
  });

  test("a pure replay (null batch id) records no batch id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            batchId: null,
            items: [{ resourceId: 1, shareeId: 8, status: "ALREADY_SHARED", shareId: 3 }],
            created: 0,
            alreadyShared: 1,
            forbidden: 0,
            notFound: 0,
          }),
        ),
      ),
    );
    const out = await createShareBatches("PERFORMANCE_REVIEW", [1], [8]);
    expect(out.alreadyShared).toBe(1);
    expect(out.batchIds).toEqual([]);
    expect(out.failure).toBeNull();
  });
});

describe("share helpers", () => {
  test("isShareLapse recognises only the lapse 403 by its detail phrase", () => {
    const lapse = new ApiError(403, { detail: "The person who shared this no longer has access to it" });
    expect(isShareLapse(lapse)).toBe(true);
    expect(isShareLapse(new ApiError(403, { detail: "Forbidden" }))).toBe(false);
    expect(isShareLapse(new ApiError(404, { detail: "The person who shared this no longer has access to it" }))).toBe(false);
    expect(isShareLapse(new Error("x"))).toBe(false);
  });

  test("invalidateShares marks every shares list, the document and the bell stale", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(documentSharesKey("GOAL", 5), { items: [] });
    queryClient.setQueryData(["shares", "withMe"], { items: [] });
    queryClient.setQueryData(["goal", 5], { id: 5 });
    queryClient.setQueryData(["goal", 6], { id: 6 });
    queryClient.setQueryData(["notifications", "list"], {});

    await invalidateShares(queryClient, "GOAL", 5);

    expect(queryClient.getQueryState(documentSharesKey("GOAL", 5))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["shares", "withMe"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["goal", 5])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["goal", 6])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["notifications", "list"])?.isInvalidated).toBe(true);
  });
});
