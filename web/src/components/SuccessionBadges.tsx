import { useTranslation } from "react-i18next";
import type {
  RetentionRisk,
  RoleCriticality,
  SuccessionPlanStatus,
} from "../api/successionPlans";
import StatusPill from "./StatusPill";
import { CRITICALITY_COLORS, RISK_COLORS } from "./successionScales";

// The succession plans' colored pills (the FeedbackBadges idiom). The severity color maps
// live in ./successionScales (shared with the definition form's sliders — the Fast-Refresh
// split). Since v3.3.0 the severity pills are the house light pill too: the AA light-variant
// inks (themeVariables.ts) made the v2.44.0 filled+autoContrast workaround unnecessary.

const STATUS_COLORS: Record<SuccessionPlanStatus, string> = {
  OPEN: "teal",
  CLOSED: "gray",
};

export function CriticalityBadge({ value }: { value: RoleCriticality }) {
  const { t } = useTranslation();
  return (
    <StatusPill color={CRITICALITY_COLORS[value]} dot>
      {t(`succession.criticality.${value}`)}
    </StatusPill>
  );
}

export function RetentionRiskBadge({ value }: { value: RetentionRisk }) {
  const { t } = useTranslation();
  return (
    <StatusPill color={RISK_COLORS[value]} dot>
      {t(`succession.risk.${value}`)}
    </StatusPill>
  );
}

export function PlanStatusBadge({ value }: { value: SuccessionPlanStatus }) {
  const { t } = useTranslation();
  return (
    <StatusPill color={STATUS_COLORS[value]} dot>
      {t(`succession.status.${value}`)}
    </StatusPill>
  );
}

/**
 * The bench-depth cue: "n / target" nominations — orange (warning, the OverdueBadge idiom)
 * while the bench is short of the target, teal once it is met. ALL nominations count
 * (emergency interims included — the user's call).
 */
export function BenchBadge({ count, target }: { count: number; target: number }) {
  const { t } = useTranslation();
  const short = count < target;
  return (
    <StatusPill
      color={short ? "orange" : "teal"}
      ariaLabel={t(short ? "succession.benchShortAria" : "succession.benchMetAria", {
        n: count,
        target,
      })}
    >
      {count} / {target}
    </StatusPill>
  );
}
