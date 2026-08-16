import { dynamicKey } from "../utils/i18nKey";
import { Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listTeamKpiEvents, type TeamKpiEvent, type TeamKpiType } from "../api/teamkpis";
import { formatIsoDate, formatTimestamp } from "../utils/datetime";
import { formatGoalValue } from "../utils/goalValues";

// Render a structured team-KPI audit event in the current language. Params carry enum names,
// numeric values, and ISO dates only (never title/description/summary text), so the wording
// names the aspect, not the content.
function describeEvent(e: TeamKpiEvent, t: TFunction, locale: string, type: TeamKpiType): string {
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

/** The team KPI's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function TeamKpiHistory({ kpiId, type }: { kpiId: number; type: TeamKpiType }) {
  const { t, i18n } = useTranslation();
  const { data: events } = useQuery({
    queryKey: ["teamKpiEvents", kpiId],
    queryFn: () => listTeamKpiEvents(kpiId),
  });

  if (!events || events.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("teamKpi.noHistory")}
      </Text>
    );
  }

  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {events.map((e) => (
        <Timeline.Item key={e.id} title={describeEvent(e, t, i18n.language, type)}>
          <Text size="xs" c="dimmed">
            {e.userName} · {formatTimestamp(e.timestamp)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
