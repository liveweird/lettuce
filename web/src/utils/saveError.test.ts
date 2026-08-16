import type { TFunction } from "i18next";
import { describe, expect, test } from "vitest";
import { ApiError } from "../api/http";
import { saveErrorMessage, type SaveErrorKeys } from "./saveError";

// A `t` stub that makes the chosen key (and any {{status}} interpolation) observable.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts?.status != null ? `${key}(${opts.status})` : key) as unknown as TFunction;

// The fake "k.*" keys make the CHOSEN key observable — brand them past the typed key union.
const keys = (partial: Record<string, string>) => partial as unknown as SaveErrorKeys;

const ALL_KEYS = keys({
  forbidden: "k.forbidden",
  notFound: "k.notFound",
  conflict: "k.conflict",
  invalid: "k.invalid",
  failedStatus: "k.failedStatus",
  failed: "k.failed",
});

describe("saveErrorMessage", () => {
  test("403 maps to forbidden", () => {
    expect(saveErrorMessage(new ApiError(403, null), t, ALL_KEYS)).toBe("k.forbidden");
  });

  test("403 without a forbidden key falls through to failedStatus", () => {
    expect(
      saveErrorMessage(new ApiError(403, null), t, keys({
        failedStatus: "k.failedStatus",
        failed: "k.failed",
      })),
    ).toBe("k.failedStatus(403)");
  });

  test("404 maps to notFound when provided", () => {
    expect(saveErrorMessage(new ApiError(404, null), t, ALL_KEYS)).toBe("k.notFound");
  });

  test("404 without a notFound key falls through to failedStatus", () => {
    expect(
      saveErrorMessage(new ApiError(404, null), t, keys({
        forbidden: "k.forbidden",
        failedStatus: "k.failedStatus",
        failed: "k.failed",
      })),
    ).toBe("k.failedStatus(404)");
  });

  test("409 maps to conflict when provided", () => {
    expect(saveErrorMessage(new ApiError(409, null), t, ALL_KEYS)).toBe("k.conflict");
  });

  test("409 without a conflict key falls through to failedStatus", () => {
    expect(
      saveErrorMessage(new ApiError(409, null), t, keys({
        forbidden: "k.forbidden",
        failedStatus: "k.failedStatus",
        failed: "k.failed",
      })),
    ).toBe("k.failedStatus(409)");
  });

  test("400 maps to invalid when provided", () => {
    expect(saveErrorMessage(new ApiError(400, null), t, ALL_KEYS)).toBe("k.invalid");
  });

  test("400 without an invalid key falls through to failedStatus", () => {
    expect(
      saveErrorMessage(new ApiError(400, null), t, keys({
        forbidden: "k.forbidden",
        failedStatus: "k.failedStatus",
        failed: "k.failed",
      })),
    ).toBe("k.failedStatus(400)");
  });

  test("an unmatched status interpolates into failedStatus", () => {
    expect(saveErrorMessage(new ApiError(500, null), t, ALL_KEYS)).toBe("k.failedStatus(500)");
  });

  test("an unmatched status without failedStatus lands on failed", () => {
    expect(
      saveErrorMessage(new ApiError(500, null), t, keys({
        forbidden: "k.forbidden",
        notFound: "k.notFound",
        invalid: "k.invalid",
        failed: "k.failed",
      })),
    ).toBe("k.failed");
  });

  test("a non-ApiError (network) failure always lands on failed", () => {
    expect(saveErrorMessage(new Error("network down"), t, ALL_KEYS)).toBe("k.failed");
    expect(saveErrorMessage(undefined, t, ALL_KEYS)).toBe("k.failed");
  });
});
