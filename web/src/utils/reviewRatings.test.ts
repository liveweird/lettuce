import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import {
  isReviewComplete,
  ratingColor,
  ratingOptions,
  ratingText,
  reviewFormValidation,
  toReviewBody,
  toReviewFormValues,
  type ReviewFormValues,
} from "./reviewRatings";

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as TFunction;

const COMPLETE: ReviewFormValues = {
  attitude: { rating: "3", summary: "a" },
  delivery: { rating: "4", summary: "b" },
  skills: { rating: "5", summary: "c" },
  overall: { rating: "4", summary: "d" },
};

describe("reviewRatings", () => {
  test("ratingColor walks the orange→green gradient and falls back to gray", () => {
    expect(ratingColor(1)).toBe("orange.8");
    expect(ratingColor(2)).toBe("orange.5");
    expect(ratingColor(3)).toBe("yellow.6");
    expect(ratingColor(4)).toBe("lime.6");
    expect(ratingColor(5)).toBe("green.5");
    expect(ratingColor(6)).toBe("green.8");
    expect(ratingColor(0)).toBe("gray");
    expect(ratingColor(7)).toBe("gray");
  });

  test("ratingText keeps the number next to its wording and options cover 1..6", () => {
    expect(ratingText(t, 4)).toBe("4 — performanceReview.rating.4");
    const options = ratingOptions(t);
    expect(options).toHaveLength(6);
    expect(options[0]).toEqual({ value: "1", label: "1 — performanceReview.rating.1" });
    expect(options[5].value).toBe("6");
  });

  test("form values round-trip: unset stays null, empty summaries normalize to null", () => {
    const response = {
      id: 1, managerId: 2, subordinateId: 3, periodId: 4,
      periodStartMonth: "2026-01", periodEndMonth: "2026-06",
      status: "DRAFT" as const,
      attitude: { rating: 5, summary: "great" },
      delivery: { rating: null, summary: null },
      skills: { rating: 2, summary: null },
      overall: { rating: null, summary: "only text" },
      createdAt: 1, lastModified: 1, managerName: "M", subordinateName: "S",
    };
    const values = toReviewFormValues(response);
    expect(values.attitude).toEqual({ rating: "5", summary: "great" });
    expect(values.delivery).toEqual({ rating: "", summary: "" });

    const body = toReviewBody({ ...values, skills: { rating: "2", summary: "   " } });
    expect(body.attitude).toEqual({ rating: 5, summary: "great" });
    expect(body.delivery).toEqual({ rating: null, summary: null });
    // Whitespace-only summaries are the same non-value as empty.
    expect(body.skills).toEqual({ rating: 2, summary: null });
  });

  test("isReviewComplete demands every rating and a non-blank summary", () => {
    expect(isReviewComplete(COMPLETE)).toBe(true);
    expect(isReviewComplete({ ...COMPLETE, skills: { rating: "", summary: "c" } })).toBe(false);
    expect(isReviewComplete({ ...COMPLETE, overall: { rating: "4", summary: "  " } })).toBe(false);
  });

  test("validation enforces bounds always and requiredness only when complete is demanded", () => {
    const lax = reviewFormValidation(t, false) as Record<string, (v: string) => string | null>;
    expect(lax["attitude.rating"]("")).toBeNull();
    expect(lax["attitude.summary"]("")).toBeNull();
    expect(lax["attitude.summary"]("x".repeat(4001))).toContain("summaryTooLong");

    const strict = reviewFormValidation(t, true) as Record<string, (v: string) => string | null>;
    expect(strict["overall.rating"]("")).toContain("ratingRequired");
    expect(strict["overall.summary"]("  ")).toContain("summaryRequired");
    expect(strict["overall.summary"]("fine")).toBeNull();
  });
});
