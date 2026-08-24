import type { TFunction } from "i18next";
import type { ImpactEntryBody, ImpactEntryResponse } from "../api/impactLog";
import { todayIsoDate } from "./datetime";
import { saveErrorMessage } from "./saveError";

export const MAX_IMPACT_TEXT_LENGTH = 5000;

// The create/edit form shape — the PUT replaces the whole document, so create and edit share it.
export interface ImpactEntryFormValues {
  periodStart: string;
  periodEnd: string;
  whatHappened: string;
  contribution: string;
  whyItMattered: string;
  evidence: string;
}

export function emptyImpactEntryValues(): ImpactEntryFormValues {
  const today = todayIsoDate();
  return {
    periodStart: today,
    periodEnd: today,
    whatHappened: "",
    contribution: "",
    whyItMattered: "",
    evidence: "",
  };
}

export function toImpactEntryFormValues(entry: ImpactEntryResponse): ImpactEntryFormValues {
  return {
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    whatHappened: entry.whatHappened,
    contribution: entry.contribution,
    whyItMattered: entry.whyItMattered,
    evidence: entry.evidence,
  };
}

export function toImpactEntryBody(values: ImpactEntryFormValues): ImpactEntryBody {
  return { ...values };
}

// Mirrors the server's validateImpactEntry (period order + non-blank bounded sections) so the
// form catches what the API would 400 on. ISO YYYY-MM-DD strings compare chronologically.
export function impactEntryValidation(t: TFunction) {
  const section = (value: string) => {
    if (!value.trim()) return t("impactLog.validation.sectionRequired");
    if (value.length > MAX_IMPACT_TEXT_LENGTH) {
      return t("impactLog.validation.sectionTooLong", { max: MAX_IMPACT_TEXT_LENGTH });
    }
    return null;
  };
  return {
    periodStart: (value: string, values: ImpactEntryFormValues) => {
      if (!value) return t("impactLog.validation.periodRequired");
      if (values.periodEnd && value > values.periodEnd) return t("impactLog.validation.periodOrder");
      return null;
    },
    periodEnd: (value: string) => (value ? null : t("impactLog.validation.periodRequired")),
    whatHappened: section,
    contribution: section,
    whyItMattered: section,
    evidence: section,
  };
}

export function impactLogSaveErrorMessage(err: unknown, t: TFunction): string {
  return saveErrorMessage(err, t, {
    forbidden: "impactLog.error.permission",
    notFound: "impactLog.error.notFound",
    invalid: "impactLog.error.invalid",
    failedStatus: "impactLog.error.saveFailedStatus",
    failed: "impactLog.error.saveFailed",
  });
}
