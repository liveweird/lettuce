import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./http";
import { createShare, getShare, listAllDocumentShares, listShares, withdrawShare } from "./shares";
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
