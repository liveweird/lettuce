import type { TFunction } from "i18next";
import type { GoalDefinitionUpdateBody, GoalResponse, GoalType } from "../api/client";
import { saveErrorMessage } from "./saveError";

export const MAX_GOAL_TITLE_LENGTH = 200;
export const MAX_GOAL_TEXT_LENGTH = 4000;

// The DRAFT definition editor's form shape. targetValue is a string | number union because
// Mantine's NumberInput reports "" while empty.
export interface GoalDefinitionFormValues {
  title: string;
  description: string;
  type: GoalType;
  targetValue: number | string;
}

export function toDefinitionFormValues(goal: GoalResponse): GoalDefinitionFormValues {
  return {
    title: goal.title,
    description: goal.description,
    type: goal.type,
    targetValue: goal.targetValue ?? "",
  };
}

export function toDefinitionBody(values: GoalDefinitionFormValues): GoalDefinitionUpdateBody {
  return {
    title: values.title,
    description: values.description,
    type: values.type,
    // BINARY carries no target; an empty NumberInput ("") never survives validation for the
    // numeric types, so the fallback is defensive only.
    targetValue:
      values.type === "BINARY" || values.targetValue === "" ? null : Number(values.targetValue),
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
      if (values.type === "BINARY") return null;
      if (value === "" || value == null) return t("goal.validation.targetRequired");
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return t("goal.validation.targetRequired");
      if (values.type === "PERCENTAGE" && (numeric < 0 || numeric > 100)) {
        return t("goal.validation.percentageRange");
      }
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
