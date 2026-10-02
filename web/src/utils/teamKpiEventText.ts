import { dynamicKey } from "./i18nKey";
import type { TFunction } from "i18next";
import { formatIsoDate } from "./datetime";
import { formatGoalValue } from "./goalValues";
import type { TeamKpiEvent, TeamKpiType } from "../api/teamkpis";

// Render a structured team-KPI audit event in the current language. Params carry enum names,
// numeric values, and ISO dates only (never title/description/summary text), so the wording
// names the aspect, not the content.
export function describeTeamKpiEvent(e: Pick<TeamKpiEvent, "type" | "params">, t: TFunction, locale: string, type: TeamKpiType): string {
  const p = e.params ?? {};
  // Server values are raw Double strings ("40.0"); format per the KPI's type (the "%" suffix for
  // PERCENTAGE) and locale, pass anything odd through. Rendered with the CURRENT type — a type
  // change wipes the data points, so pre-change VALUE_* entries are already historical anyway.
  const num = (raw: string | undefined) => {
    const parsed = Number(raw);
    return raw && Number.isFinite(parsed) ? formatGoalValue(type, parsed, locale) : (raw ?? "");
  };
  switch (e.type) {
    case "CREATED":
      return t("teamKpi.event.created", { type: t(dynamicKey(`teamKpi.type.${p.type}`)) });
    case "TITLE_CHANGED":
      return t("teamKpi.event.titleChanged");
    case "DESCRIPTION_CHANGED":
      return t("teamKpi.event.descriptionChanged");
    case "TYPE_CHANGED":
      return t("teamKpi.event.typeChanged", {
        from: t(dynamicKey(`teamKpi.type.${p.from}`)),
        to: t(dynamicKey(`teamKpi.type.${p.to}`)),
      });
    case "TARGET_CHANGED":
      return t("teamKpi.event.targetChanged", { from: num(p.from), to: num(p.to) });
    case "TARGET_DIRECTION_CHANGED":
      return t("teamKpi.event.targetDirectionChanged", {
        from: t(dynamicKey(`teamKpi.targetDirection.${p.from}`)),
        to: t(dynamicKey(`teamKpi.targetDirection.${p.to}`)),
      });
    case "VALUE_RECORDED":
      return t("teamKpi.event.valueRecorded", {
        value: num(p.value),
        date: formatIsoDate(p.date ?? "", locale),
      });
    case "VALUE_CORRECTED":
      return t("teamKpi.event.valueCorrected", {
        fromValue: num(p.fromValue),
        fromDate: formatIsoDate(p.fromDate ?? "", locale),
        toValue: num(p.toValue),
        toDate: formatIsoDate(p.toDate ?? "", locale),
      });
    case "VALUE_REMOVED":
      return t("teamKpi.event.valueRemoved", {
        value: num(p.value),
        date: formatIsoDate(p.date ?? "", locale),
      });
    case "STATUS_CHANGED":
      return t("teamKpi.event.statusChanged", {
        from: t(dynamicKey(`teamKpi.status.${p.from}`)),
        to: t(dynamicKey(`teamKpi.status.${p.to}`)),
      });
    case "DELETED":
      return t("teamKpi.event.deleted");
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}
