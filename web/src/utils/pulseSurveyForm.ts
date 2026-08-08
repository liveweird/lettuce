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

// The favourability color language (the reviewRatings.ts ramp, re-cut for these scales):
// the less favourable, the more orange; the more favourable, the more green. Mantine shade
// tokens — render as `var(--mantine-color-<token with . -> ->)` where a raw CSS color is needed.
const SCALE_COLORS: Record<PulseScaleAnswer, string> = {
  "1": "orange.8",
  "2": "orange.5",
  "3": "yellow.6",
  "4": "lime.6",
  "5": "green.8",
  NA: "gray.5",
};

/** The agreement scale's favourability color; "Not applicable" stays neutral gray. */
export function pulseScaleColor(answer: PulseScaleAnswer): string {
  return SCALE_COLORS[answer] ?? "gray.5";
}

// Graded across the eNPS bands: detractors (0-6) shade out of orange, passives (7-8) sit in
// the yellow/lime middle, promoters (9-10) go green.
const ENPS_COLORS: Record<number, string> = {
  0: "orange.9",
  1: "orange.8",
  2: "orange.8",
  3: "orange.7",
  4: "orange.6",
  5: "orange.5",
  6: "orange.4",
  7: "yellow.6",
  8: "lime.6",
  9: "green.5",
  10: "green.8",
};

/** The eNPS answer's band color; out-of-range values fall back to gray (forward-compat). */
export function enpsColor(score: number): string {
  return ENPS_COLORS[score] ?? "gray.5";
}

/** A Mantine shade token as a CSS variable ("green.8" -> "var(--mantine-color-green-8)"). */
export function mantineColorVar(token: string): string {
  return `var(--mantine-color-${token.replace(".", "-")})`;
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
