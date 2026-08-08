import type { PulseMyResponse, PulseScaleAnswer, PulseSubmitBody } from "../api/client";
import { saveErrorMessage } from "./saveError";

export const PULSE_MAX_COMMENT = 1000;

/** The five agreement points in display order; "NA" renders visually separated. */
export const PULSE_SCALE_VALUES: readonly PulseScaleAnswer[] = ["1", "2", "3", "4", "5"];

export interface PulseFormValues {
  enps: number | null;
  q2: PulseScaleAnswer | null;
  q3: PulseScaleAnswer | null;
  q4: PulseScaleAnswer | null;
  q5: PulseScaleAnswer | null;
  rotating: PulseScaleAnswer | null;
  comment: string;
}

export const SCALE_FIELDS = ["q2", "q3", "q4", "q5", "rotating"] as const;
export type PulseScaleField = (typeof SCALE_FIELDS)[number];

export function emptyPulseFormValues(): PulseFormValues {
  return { enps: null, q2: null, q3: null, q4: null, q5: null, rotating: null, comment: "" };
}

export function toPulseFormValues(saved: PulseMyResponse): PulseFormValues {
  return {
    enps: saved.enps,
    q2: saved.q2,
    q3: saved.q3,
    q4: saved.q4,
    q5: saved.q5,
    rotating: saved.rotating,
    comment: saved.comment ?? "",
  };
}

/** Values are validated before this runs — the non-null assertions are the validation contract. */
export function toPulseSubmitBody(values: PulseFormValues): PulseSubmitBody {
  const comment = values.comment.trim();
  return {
    enps: values.enps!,
    q2: values.q2!,
    q3: values.q3!,
    q4: values.q4!,
    q5: values.q5!,
    rotating: values.rotating!,
    ...(comment.length > 0 ? { comment } : {}),
  };
}

/** How many of the six required scored questions are answered (drives the progress line). */
export function answeredCount(values: PulseFormValues): number {
  const scales = SCALE_FIELDS.filter((f) => values[f] !== null).length;
  return (values.enps !== null ? 1 : 0) + scales;
}

/**
 * The Q7 prompt follows the eNPS band: detractors (0-6) are asked what to improve, passives
 * (7-8) what would gain a point, promoters (9-10) what to preserve; unanswered gets the
 * neutral default.
 */
export function commentPromptKey(enps: number | null): "low" | "mid" | "high" | "default" {
  if (enps === null) return "default";
  if (enps <= 6) return "low";
  if (enps <= 8) return "mid";
  return "high";
}

export function pulseFormValidation(t: (key: string, opts?: Record<string, unknown>) => string) {
  const required = (value: number | PulseScaleAnswer | null) =>
    value === null ? t("pulse.validation.answerRequired") : null;
  return {
    enps: required,
    q2: required,
    q3: required,
    q4: required,
    q5: required,
    rotating: required,
    comment: (value: string) =>
      value.trim().length > PULSE_MAX_COMMENT
        ? t("pulse.validation.commentTooLong", { max: PULSE_MAX_COMMENT })
        : null,
  };
}

export function pulseSaveErrorMessage(
  err: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return saveErrorMessage(err, t, {
    forbidden: "pulse.error.submitForbidden",
    conflict: "pulse.error.submitConflict",
    invalid: "pulse.error.invalid",
    failedStatus: "pulse.error.failedStatus",
    failed: "pulse.error.failed",
  });
}
