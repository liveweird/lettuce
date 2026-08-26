import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import type {
  CandidateAwareness,
  NominationType,
  RetentionRisk,
  RoleCriticality,
  SuccessionNominationBody,
  SuccessionNominationResponse,
  SuccessionPlanResponse,
  SuccessionPlanUpdateBody,
  SuccessorReadiness,
} from "../api/successionPlans";
import { saveErrorMessage } from "./saveError";

// Mirror of the server bounds (SuccessionPlan.kt).
export const MAX_SUCCESSION_LIST_ITEMS = 20;
export const MAX_SUCCESSION_ITEM_LENGTH = 200;
export const MIN_BENCH_DEPTH = 1;
export const MAX_BENCH_DEPTH = 10;
const DEFAULT_BENCH_DEPTH = 2;

/**
 * One row of an ordered short-text list; `key` is the React identity of an unsaved draft.
 * `filled` exists only on competency-gap rows (v2.45.0 — the progress flag; loss-impact rows
 * never set it and the editor renders its checkbox only on opt-in).
 */
export type TextRowDraft = { key: number; value: string; filled?: boolean };

let draftKey = 0;
export function emptyTextRowDraft(value = ""): TextRowDraft {
  draftKey += 1;
  return { key: draftKey, value };
}

// ── plan definition ─────────────────────────────────────────────────────────────────────────

export interface SuccessionPlanFormValues {
  roleCriticality: RoleCriticality;
  retentionRisk: RetentionRisk;
  lossImpact: TextRowDraft[];
  targetBenchDepth: number | string;
}

export function emptySuccessionPlanValues(): SuccessionPlanFormValues {
  return {
    roleCriticality: "CORE",
    retentionRisk: "MEDIUM",
    lossImpact: [],
    targetBenchDepth: DEFAULT_BENCH_DEPTH,
  };
}

export function toSuccessionPlanFormValues(plan: SuccessionPlanResponse): SuccessionPlanFormValues {
  return {
    roleCriticality: plan.roleCriticality,
    retentionRisk: plan.retentionRisk,
    lossImpact: plan.lossImpact.map((value) => emptyTextRowDraft(value)),
    targetBenchDepth: plan.targetBenchDepth,
  };
}

export function toSuccessionPlanBody(values: SuccessionPlanFormValues): SuccessionPlanUpdateBody {
  return {
    roleCriticality: values.roleCriticality,
    retentionRisk: values.retentionRisk,
    lossImpact: values.lossImpact.map((row) => row.value.trim()),
    targetBenchDepth: Number(values.targetBenchDepth),
  };
}

/**
 * Whether the definition form differs from the stored plan — compared over the PAYLOADS, not
 * Mantine's dirty flags (checkup-29: `form.isDirty()` misses `insertListItem`/`removeListItem`/
 * `reorderListItem`, so a loss-impact row edit could vanish behind a false-clean form).
 */
export function definitionDirty(
  values: SuccessionPlanFormValues,
  plan: SuccessionPlanResponse,
): boolean {
  const reference: SuccessionPlanUpdateBody = {
    roleCriticality: plan.roleCriticality,
    retentionRisk: plan.retentionRisk,
    lossImpact: plan.lossImpact,
    targetBenchDepth: plan.targetBenchDepth,
  };
  return JSON.stringify(toSuccessionPlanBody(values)) !== JSON.stringify(reference);
}

/** Per-row validation for an ordered short-text list (loss impact / competency gaps). */
function textListValidation(t: TFunction) {
  return {
    value: (value: string) => {
      if (!value.trim()) return t("succession.validation.itemRequired");
      if (value.length > MAX_SUCCESSION_ITEM_LENGTH) {
        return t("succession.validation.itemTooLong", { max: MAX_SUCCESSION_ITEM_LENGTH });
      }
      return null;
    },
  };
}

export function successionPlanValidation(t: TFunction) {
  return {
    targetBenchDepth: (value: number | string) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < MIN_BENCH_DEPTH || n > MAX_BENCH_DEPTH) {
        return t("succession.validation.benchDepth", { min: MIN_BENCH_DEPTH, max: MAX_BENCH_DEPTH });
      }
      return null;
    },
    lossImpact: textListValidation(t),
  };
}

// ── nomination ──────────────────────────────────────────────────────────────────────────────

export interface SuccessionNominationFormValues {
  /** Select value — the candidate's user id as a string, null until picked. */
  candidateId: string | null;
  readiness: SuccessorReadiness;
  nominationType: NominationType;
  competencyGaps: TextRowDraft[];
  awareness: CandidateAwareness;
  /** MultiSelect values — linked goal ids as strings, selection order preserved. */
  goalIds: string[];
}

export function emptyNominationValues(): SuccessionNominationFormValues {
  return {
    candidateId: null,
    readiness: "READY_SOON",
    nominationType: "PRIMARY",
    competencyGaps: [],
    awareness: "IMPLICIT",
    goalIds: [],
  };
}

export function toNominationFormValues(
  nomination: SuccessionNominationResponse,
): SuccessionNominationFormValues {
  return {
    candidateId: String(nomination.candidateId),
    readiness: nomination.readiness,
    nominationType: nomination.nominationType,
    competencyGaps: nomination.competencyGaps.map((gap) => ({
      ...emptyTextRowDraft(gap.text),
      filled: gap.filled ?? false,
    })),
    awareness: nomination.awareness,
    goalIds: nomination.goals.map((goal) => String(goal.id)),
  };
}

export function toNominationBody(values: SuccessionNominationFormValues): SuccessionNominationBody {
  return {
    candidateId: Number(values.candidateId),
    readiness: values.readiness,
    nominationType: values.nominationType,
    competencyGaps: values.competencyGaps.map((row) => ({
      text: row.value.trim(),
      filled: row.filled ?? false,
    })),
    awareness: values.awareness,
    goalIds: values.goalIds.map(Number),
  };
}

export function nominationValidation(t: TFunction) {
  return {
    candidateId: (value: string | null) =>
      value == null ? t("succession.validation.candidateRequired") : null,
    competencyGaps: textListValidation(t),
  };
}

// ── shared ──────────────────────────────────────────────────────────────────────────────────

/** The detail pages' load-failure wording (404/403/other) — shared by view/edit/nominate. */
export function successionLoadErrorMessage(err: unknown, t: TFunction): string {
  const status = err instanceof ApiError ? err.status : null;
  if (status === 404) return t("succession.error.notFound");
  if (status === 403) return t("succession.error.viewPermission");
  return t("succession.error.loadFailed");
}

export function successionSaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "succession.error.permission",
    notFound: "succession.error.notFound",
    conflict: "succession.error.conflict",
    invalid: "succession.error.invalid",
    failedStatus: "succession.error.saveFailedStatus",
    failed: "succession.error.saveFailed",
  });
}
