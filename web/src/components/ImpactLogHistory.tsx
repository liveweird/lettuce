import { dynamicKey } from "../utils/i18nKey";
import { Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listImpactEntryEvents, type ImpactEntryEvent } from "../api/impactLog";
import { formatIsoDate } from "../utils/datetime";
import EventTimeline from "./EventTimeline";

// The changed-field vocabulary of the UPDATED event's `changed` list → the field labels.
const FIELD_LABELS: Record<string, string> = {
  periodStart: "impactLog.periodStart",
  periodEnd: "impactLog.periodEnd",
  whatHappened: "impactLog.whatHappened",
  contribution: "impactLog.contribution",
  whyItMattered: "impactLog.whyItMattered",
  evidence: "impactLog.evidence",
};

// Render a structured entry audit event in the current language. Params carry ISO dates and
// field-name lists only (never section text), so the wording names the aspect, not the content.
function describeEvent(e: ImpactEntryEvent, t: TFunction, locale: string): string {
  const p = e.params ?? {};
  switch (e.type) {
    case "CREATED":
      return t("impactLog.event.created", {
        periodStart: formatIsoDate(p.periodStart ?? "", locale),
        periodEnd: formatIsoDate(p.periodEnd ?? "", locale),
      });
    case "UPDATED": {
      const fields = (p.changed ?? "")
        .split(",")
        .filter(Boolean)
        // A field name this client build doesn't know renders raw (forward-compat).
        .map((f) => {
          const key = FIELD_LABELS[f];
          return key ? t(dynamicKey(key)) : f;
        })
        .join(", ");
      return t("impactLog.event.updated", { fields });
    }
    case "DELETED":
      return t("impactLog.event.deleted");
    default:
      // Forward-compat: an event kind this client build doesn't know yet — show the raw type.
      return e.type;
  }
}

// The UPDATED event's period deltas (present only when the period moved) — one body line per
// moved bound.
function periodDeltas(e: ImpactEntryEvent, t: TFunction, locale: string): string[] {
  if (e.type !== "UPDATED") return [];
  const p = e.params ?? {};
  const lines: string[] = [];
  if (p.periodStartFrom != null && p.periodStartTo != null) {
    lines.push(
      t("impactLog.event.periodDelta", {
        label: t("impactLog.periodStart"),
        from: formatIsoDate(p.periodStartFrom, locale),
        to: formatIsoDate(p.periodStartTo, locale),
      }),
    );
  }
  if (p.periodEndFrom != null && p.periodEndTo != null) {
    lines.push(
      t("impactLog.event.periodDelta", {
        label: t("impactLog.periodEnd"),
        from: formatIsoDate(p.periodEndFrom, locale),
        to: formatIsoDate(p.periodEndTo, locale),
      }),
    );
  }
  return lines;
}

/** The entry's audit history as a timeline (newest first, server-ordered), or an empty-state note. */
export default function ImpactLogHistory({ entryId }: { entryId: number }) {
  const { t, i18n } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["impactEntryEvents", entryId],
    queryFn: () => listImpactEntryEvents(entryId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("impactLog.noHistory")}
      renderTitle={(e) => describeEvent(e, t, i18n.language)}
      renderBody={(e) => {
        const deltas = periodDeltas(e, t, i18n.language);
        return deltas.length > 0 ? (
          <>
            {deltas.map((line) => (
              <Text key={line} size="sm" c="dimmed">
                {line}
              </Text>
            ))}
          </>
        ) : null;
      }}
    />
  );
}
