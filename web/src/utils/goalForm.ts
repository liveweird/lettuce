import type { TFunction } from "i18next";
import type { GoalDefinitionUpdateBody, GoalResponse, GoalType, TargetDirection } from "../api/goals";
import { todayIsoDate } from "./datetime";
import { saveErrorMessage } from "./saveError";

export const MAX_GOAL_TITLE_LENGTH = 200;
export const MAX_GOAL_TEXT_LENGTH = 4000;
export const MAX_GOAL_MILESTONES = 100;

// A PLAN milestone row in the definition editor (the oneOnOneForm draft-row scheme): the local
// `key` is the React list identity (stable across reorders), the server `id` is preserved in
// the PUT body so the backend tells edits from add/remove — new rows simply have no id. The
// done flag is display-only here (defining is not ticking — the server preserves it by id).
export type GoalMilestoneDraft = {
  key: string;
  id?: number;
  description: string;
  done: boolean;
};

let milestoneKeyCounter = 0;
export function emptyMilestoneDraft(): GoalMilestoneDraft {
  milestoneKeyCounter += 1;
  return { key: `milestone-${milestoneKeyCounter}`, description: "", done: false };
}

// The DRAFT definition editor's form shape. targetValue is a string | number union because
// Mantine's NumberInput reports "" while empty.
export interface GoalDefinitionFormValues {
  title: string;
  description: string;
  type: GoalType;
  targetValue: number | string;
  targetDirection: TargetDirection;
  milestones: GoalMilestoneDraft[];
  dueDate: string;
}

export function toDefinitionFormValues(goal: GoalResponse): GoalDefinitionFormValues {
  milestoneKeyCounter += 1;
  return {
    title: goal.title,
    description: goal.description,
    type: goal.type,
    targetValue: goal.targetValue ?? "",
    // PLAN rows carry null server-side; the form keeps the default so a later type switch
    // starts from "at least".
    targetDirection: goal.targetDirection ?? "AT_LEAST",
    milestones: goal.milestones.map((m, i) => ({
      key: `milestone-loaded-${milestoneKeyCounter}-${i}`,
      id: m.id,
      description: m.description,
      done: m.done,
    })),
    dueDate: goal.dueDate,
  };
}

export function toDefinitionBody(values: GoalDefinitionFormValues): GoalDefinitionUpdateBody {
  return {
    title: values.title,
    description: values.description,
    type: values.type,
    // PLAN carries no target; an empty NumberInput ("") never survives validation for the
    // numeric types, so the fallback is defensive only.
    targetValue:
      values.type === "PLAN" || values.targetValue === "" ? null : Number(values.targetValue),
    // PLAN carries no direction (the server 400s one), like the target.
    targetDirection: values.type === "PLAN" ? null : values.targetDirection,
    // Milestones apply to PLAN only (the server 400s them elsewhere); keys stripped, ids
    // preserved, payload order IS the order.
    milestones:
      values.type === "PLAN"
        ? values.milestones.map((m) => ({ id: m.id, description: m.description }))
        : [],
    dueDate: values.dueDate,
  };
}

// Mirrors the server's validateGoalDefinition (per-type target rules) so the form catches what
// the API would 400 on.
export function goalDefinitionValidation(t: TFunction) {
  return {
    title: (value: string) => {
      if (!value.trim()) return t("goal.validation.titleRequired");
      if (value.length > MAX_GOAL_TITLE_LENGTH) {
        return t("goal.validation.titleTooLong", { max: MAX_GOAL_TITLE_LENGTH });
      }
      return null;
    },
    description: (value: string) =>
      value.length > MAX_GOAL_TEXT_LENGTH
        ? t("goal.validation.descriptionTooLong", { max: MAX_GOAL_TEXT_LENGTH })
        : null,
    targetValue: (value: number | string, values: GoalDefinitionFormValues) => {
      if (values.type === "PLAN") return null;
      if (value === "" || value == null) return t("goal.validation.targetRequired");
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return t("goal.validation.targetRequired");
      if (values.type === "PERCENTAGE" && (numeric < 0 || numeric > 100)) {
        return t("goal.validation.percentageRange");
      }
      return null;
    },
    milestones: {
      description: (value: string, values: GoalDefinitionFormValues) => {
        if (values.type !== "PLAN") return null;
        if (!value.trim()) return t("goal.validation.milestoneRequired");
        if (value.length > MAX_GOAL_TEXT_LENGTH) {
          return t("goal.validation.milestoneTooLong", { max: MAX_GOAL_TEXT_LENGTH });
        }
        return null;
      },
    },
    // ISO strings compare chronologically, so a plain string compare mirrors the server rule
    // (dueDate === today is valid).
    dueDate: (value: string) => {
      if (!value) return t("goal.validation.dueDateRequired");
      if (value < todayIsoDate()) return t("goal.validation.dueDateInPast");
      return null;
    },
  };
}

export function goalSaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "goal.error.savePermission",
    notFound: "goal.error.gone",
    conflict: "goal.error.conflict",
    invalid: "goal.error.invalid",
    failedStatus: "goal.error.updateFailedStatus",
    failed: "goal.error.updateFailed",
  });
}
