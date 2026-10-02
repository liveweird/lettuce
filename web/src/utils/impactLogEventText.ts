import type { ParseKeys, TFunction } from "i18next";
import { formatIsoDate } from "./datetime";
import type { ImpactEntryEvent } from "../api/impactLog";

// The changed-field vocabulary of the UPDATED event's `changed` list → the field labels.
// ParseKeys values (never string) so a typo or a missing key fails tsc — the lookup key is
// server-supplied, but this value union is statically known (the web/CLAUDE.md typing rule).
const FIELD_LABELS: Record<string, ParseKeys> = {
  title: "impactLog.title",
  periodStart: "impactLog.periodStart",
  periodEnd: "impactLog.periodEnd",
  whatHappened: "impactLog.whatHappened",
  contribution: "impactLog.contribution",
  whyItMattered: "impactLog.whyItMattered",
  evidence: "impactLog.evidence",
};

// Render a structured entry audit event in the current language. Params carry ISO dates and
// field-name lists only (never section text), so the wording names the aspect, not the content.
export function describeImpactLogEvent(e: Pick<ImpactEntryEvent, "type" | "params">, t: TFunction, locale: string): string {
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
          return key ? t(key) : f;
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
