import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "./http";
import { listShareCandidates } from "./reviews";
import { jsonResponse } from "../test/http";

describe("listShareCandidates", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("GETs the period's candidates and returns the whole list envelope", async () => {
    const body = { periodId: 4, items: [{ userId: 2, name: "Mia", shareable: true, reason: null }] };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, body)));
    vi.stubGlobal("fetch", fetchMock);

    const list = await listShareCandidates(4);

    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      "/api/v1/performance-reviews/share-candidates?periodId=4",
    );
    expect(list).toEqual(body);
  });

  test("an error answer surfaces as ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(400, { title: "Bad Request", status: 400, detail: "Referenced review period does not exist" }))),
    );
    const err = await listShareCandidates(999).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});
