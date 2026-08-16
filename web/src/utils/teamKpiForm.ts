import type { TFunction } from "i18next";
import type { TeamKpiDefinitionUpdateBody, TeamKpiResponse, TeamKpiType } from "../api/teamkpis";
import { saveErrorMessage } from "./saveError";

export const MAX_TEAM_KPI_TITLE_LENGTH = 200;
export const MAX_TEAM_KPI_TEXT_LENGTH = 4000;

// The DRAFT definition editor's form shape. targetValue is a string | number union because
// Mantine's NumberInput reports "" while empty. No due date — team KPIs don't have one.
export interface TeamKpiDefinitionFormValues {
  title: string;
  description: string;
  type: TeamKpiType;
  targetValue: number | string;
}

export function toKpiDefinitionFormValues(kpi: TeamKpiResponse): TeamKpiDefinitionFormValues {
  return {
    title: kpi.title,
    description: kpi.description,
    type: kpi.type,
    targetValue: kpi.targetValue,
  };
}

export function toKpiDefinitionBody(values: TeamKpiDefinitionFormValues): TeamKpiDefinitionUpdateBody {
  return {
    title: values.title,
    description: values.description,
    type: values.type,
    // An empty NumberInput ("") never survives validation, so the fallback is defensive only.
    targetValue: values.targetValue === "" ? 0 : Number(values.targetValue),
  };
}

// Mirrors the server's validateTeamKpiDefinition (target always required; 0–100 for
// PERCENTAGE) so the form catches what the API would 400 on.
export function teamKpiDefinitionValidation(t: TFunction) {
  return {
    title: (value: string) => {
      if (!value.trim()) return t("teamKpi.validation.titleRequired");
      if (value.length > MAX_TEAM_KPI_TITLE_LENGTH) {
        return t("teamKpi.validation.titleTooLong", { max: MAX_TEAM_KPI_TITLE_LENGTH });
      }
      return null;
    },
    description: (value: string) =>
      value.length > MAX_TEAM_KPI_TEXT_LENGTH
        ? t("teamKpi.validation.descriptionTooLong", { max: MAX_TEAM_KPI_TEXT_LENGTH })
        : null,
    targetValue: (value: number | string, values: TeamKpiDefinitionFormValues) => {
      if (value === "" || value == null) return t("teamKpi.validation.targetRequired");
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return t("teamKpi.validation.targetRequired");
      if (values.type === "PERCENTAGE" && (numeric < 0 || numeric > 100)) {
        return t("teamKpi.validation.percentageRange");
      }
      return null;
    },
  };
}

export function teamKpiSaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "teamKpi.error.savePermission",
    notFound: "teamKpi.error.gone",
    conflict: "teamKpi.error.conflict",
    invalid: "teamKpi.error.invalid",
    failedStatus: "teamKpi.error.updateFailedStatus",
    failed: "teamKpi.error.updateFailed",
  });
}
