import { useQuery } from "@tanstack/react-query";
import type { ParseKeys, TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { listSuccessionPlanEvents, type SuccessionPlanEvent } from "../api/successionPlans";
import { dynamicKey } from "../utils/i18nKey";
import EventTimeline from "./EventTimeline";

// The NOMINATION_UPDATED event's `changed` tokens → existing form-label keys. ParseKeys
// values (never string) so a typo or a missing key fails tsc; an unknown wire token renders
// raw (forward-compat).
const FIELD_LABELS: Record<string, ParseKeys> = {
  candidate: "succession.candidate",
  readiness: "succession.readinessLabel",
  nominationType: "succession.nominationTypeLabel",
  awareness: "succession.awarenessLabel",
  competencyGaps: "succession.competencyGaps",
  goals: "succession.developmentGoals",
};

function enumLabel(t: TFunction, block: string, value: string | undefined): string {
  if (!value) return "";
  return t(dynamicKey(`succession.${block}.${value}`));
}

// One localized sentence per event (the ImpactLogHistory shape): enum params interpolate
// through the existing label blocks via dynamicKey; unknown event kinds render their raw
// type (forward-compat). Params never carry loss-impact/competency-gap text by construction.
function describeEvent(e: SuccessionPlanEvent, t: TFunction): string {
  const p = e.params ?? {};
  switch (e.type) {
    case "CREATED":
      return t("succession.event.created", {
        criticality: enumLabel(t, "criticality", p.roleCriticality),
        risk: enumLabel(t, "risk", p.retentionRisk),
        target: p.targetBenchDepth ?? "",
      });
    case "CRITICALITY_CHANGED":
      return t("succession.event.criticalityChanged", {
        from: enumLabel(t, "criticality", p.from),
        to: enumLabel(t, "criticality", p.to),
      });
    case "RISK_CHANGED":
      return t("succession.event.riskChanged", {
        from: enumLabel(t, "risk", p.from),
        to: enumLabel(t, "risk", p.to),
      });
    case "BENCH_DEPTH_CHANGED":
      return t("succession.event.benchDepthChanged", { from: p.from ?? "", to: p.to ?? "" });
    case "LOSS_IMPACT_CHANGED":
      return t("succession.event.lossImpactChanged");
    case "REVIEW_COMPLETED":
      return t("succession.event.reviewCompleted");
    case "CLOSED":
      return t("succession.event.closed");
    case "DELETED":
      return t("succession.event.deleted");
    case "NOMINATION_ADDED":
      return t("succession.event.nominationAdded", {
        name: p.candidateName ?? "",
        readiness: enumLabel(t, "readiness", p.readiness),
        type: enumLabel(t, "nominationType", p.nominationType),
      });
    case "NOMINATION_UPDATED": {
      const fields = (p.changed ?? "")
        .split(",")
        .filter(Boolean)
        .map((field) => (FIELD_LABELS[field] ? t(FIELD_LABELS[field]) : field))
        .join(", ");
      return t("succession.event.nominationUpdated", { name: p.candidateName ?? "", fields });
    }
    case "NOMINATION_REMOVED":
      return t("succession.event.nominationRemoved", { name: p.candidateName ?? "" });
    case "PRIMARY_DEMOTED":
      return t("succession.event.primaryDemoted", { name: p.candidateName ?? "" });
    default:
      return e.type;
  }
}

/** The Review screen's History tab: the plan's audit trail, localized client-side. */
export default function SuccessionHistory({ planId }: { planId: number }) {
  const { t } = useTranslation();
  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["successionPlanEvents", planId],
    queryFn: () => listSuccessionPlanEvents(planId),
  });

  return (
    <EventTimeline
      events={events}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage={t("succession.noHistory")}
      renderTitle={(e) => describeEvent(e, t)}
    />
  );
}
