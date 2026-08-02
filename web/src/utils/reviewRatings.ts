import type { TFunction } from "i18next";
import type {
  CategoryAssessment,
  PerformanceReviewResponse,
  PerformanceReviewUpdateBody,
} from "../api/client";
import { saveErrorMessage } from "./saveError";

export const MAX_REVIEW_SUMMARY_LENGTH = 4000;

/** The fixed 1–6 scale — the numeric value travels on the wire; the wording is i18n. */
export const RATING_VALUES = [1, 2, 3, 4, 5, 6] as const;

export const REVIEW_CATEGORIES = ["attitude", "delivery", "skills", "overall"] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/** The localized scale wording for a rating ("Sometimes exceeds expectations"). */
export function ratingLabel(t: TFunction, rating: number): string {
  return t(`performanceReview.rating.${rating}`);
}

/** "4 — Sometimes exceeds expectations": the number stays visible next to its wording. */
export function ratingText(t: TFunction, rating: number): string {
  return `${rating} — ${ratingLabel(t, rating)}`;
}

/** Select options for the rating pickers (string values — the Mantine Select contract). */
export function ratingOptions(t: TFunction): { value: string; label: string }[] {
  return RATING_VALUES.map((r) => ({ value: String(r), label: ratingText(t, r) }));
}

// The editor's form shape: one {rating, summary} pair per category; the rating is the Select's
// string value ("" = unset — legal while DRAFT).
export interface CategoryFormValues {
  rating: string;
  summary: string;
}

export type ReviewFormValues = Record<ReviewCategory, CategoryFormValues>;

function toCategoryFormValues(assessment: CategoryAssessment): CategoryFormValues {
  return {
    rating: assessment.rating != null ? String(assessment.rating) : "",
    summary: assessment.summary ?? "",
  };
}

export function toReviewFormValues(review: PerformanceReviewResponse): ReviewFormValues {
  return {
    attitude: toCategoryFormValues(review.attitude),
    delivery: toCategoryFormValues(review.delivery),
    skills: toCategoryFormValues(review.skills),
    overall: toCategoryFormValues(review.overall),
  };
}

function toAssessment(values: CategoryFormValues): CategoryAssessment {
  return {
    rating: values.rating === "" ? null : Number(values.rating),
    summary: values.summary.trim() === "" ? null : values.summary,
  };
}

export function toReviewBody(values: ReviewFormValues): PerformanceReviewUpdateBody {
  return {
    attitude: toAssessment(values.attitude),
    delivery: toAssessment(values.delivery),
    skills: toAssessment(values.skills),
    overall: toAssessment(values.overall),
  };
}

/** Every rating set and every summary non-blank — the DRAFT→CALIBRATION gate, client-side. */
export function isReviewComplete(values: ReviewFormValues): boolean {
  return REVIEW_CATEGORIES.every(
    (c) => values[c].rating !== "" && values[c].summary.trim() !== "",
  );
}

/**
 * Mirrors the server's rules so the form catches what the API would 400 on: summaries within
 * bounds always; with [requireComplete] (a CALIBRATION edit — a value may change but never
 * blank out) every rating and summary is additionally required.
 */
export function reviewFormValidation(t: TFunction, requireComplete: boolean) {
  const summaryRule = (value: string) => {
    if (value.length > MAX_REVIEW_SUMMARY_LENGTH) {
      return t("performanceReview.validation.summaryTooLong", { max: MAX_REVIEW_SUMMARY_LENGTH });
    }
    if (requireComplete && value.trim() === "") {
      return t("performanceReview.validation.summaryRequired");
    }
    return null;
  };
  const ratingRule = (value: string) =>
    requireComplete && value === "" ? t("performanceReview.validation.ratingRequired") : null;
  return Object.fromEntries(
    REVIEW_CATEGORIES.flatMap((c) => [
      [`${c}.rating`, ratingRule],
      [`${c}.summary`, summaryRule],
    ]),
  );
}

export function reviewSaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "performanceReview.error.savePermission",
    notFound: "performanceReview.error.gone",
    conflict: "performanceReview.error.conflict",
    invalid: "performanceReview.error.invalid",
    failedStatus: "performanceReview.error.updateFailedStatus",
    failed: "performanceReview.error.updateFailed",
  });
}
