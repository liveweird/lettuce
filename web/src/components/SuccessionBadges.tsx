import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type {
  RetentionRisk,
  RoleCriticality,
  SuccessionPlanStatus,
} from "../api/successionPlans";
import { CRITICALITY_COLORS, RISK_COLORS } from "./successionScales";

// The succession plans' colored pills (the FeedbackBadges idiom), with min-width so table
// cells never ellipsize them. The severity color maps live in ./successionScales (shared
// with the definition form's sliders — the Fast-Refresh split); the two severity badges are
// `variant="filled"` + `autoContrast` (v2.44.0 — the light variant was barely readable on
// yellow/orange), while the status/bench pills keep the house light variant.

const STATUS_COLORS: Record<SuccessionPlanStatus, string> = {
  OPEN: "teal",
  CLOSED: "gray",
};

export function CriticalityBadge({ value }: { value: RoleCriticality }) {
  const { t } = useTranslation();
  return (
    <Badge
      color={CRITICALITY_COLORS[value]}
      variant="filled"
      autoContrast
      style={{ minWidth: "max-content" }}
    >
      {t(`succession.criticality.${value}`)}
    </Badge>
  );
}

export function RetentionRiskBadge({ value }: { value: RetentionRisk }) {
  const { t } = useTranslation();
  return (
    <Badge color={RISK_COLORS[value]} variant="filled" autoContrast style={{ minWidth: "max-content" }}>
      {t(`succession.risk.${value}`)}
    </Badge>
  );
}

export function PlanStatusBadge({ value }: { value: SuccessionPlanStatus }) {
  const { t } = useTranslation();
  return (
    <Badge color={STATUS_COLORS[value]} variant="light" style={{ minWidth: "max-content" }}>
      {t(`succession.status.${value}`)}
    </Badge>
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
    <Badge
      color={short ? "orange" : "teal"}
      variant="light"
      style={{ minWidth: "max-content" }}
      aria-label={t(short ? "succession.benchShortAria" : "succession.benchMetAria", {
        n: count,
        target,
      })}
    >
      {count} / {target}
    </Badge>
  );
}
