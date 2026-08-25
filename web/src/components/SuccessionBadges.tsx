import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type {
  RetentionRisk,
  RoleCriticality,
  SuccessionPlanStatus,
} from "../api/successionPlans";

// The succession plans' colored pills — single color source (the FeedbackBadges idiom), all
// `variant="light"` + min-width so table cells never ellipsize them. Semantic palette rules:
// red/orange grade the severity scales (the ratingColor direction), teal marks the good side
// (never brand green), gray the neutral/terminal states.

const CRITICALITY_COLORS: Record<RoleCriticality, string> = {
  CRITICAL: "red.7",
  CORE: "orange.6",
  STANDARD: "gray.6",
};

const RISK_COLORS: Record<RetentionRisk, string> = {
  HIGH: "orange.8",
  MEDIUM: "yellow.6",
  LOW: "teal",
};

const STATUS_COLORS: Record<SuccessionPlanStatus, string> = {
  OPEN: "teal",
  CLOSED: "gray",
};

export function CriticalityBadge({ value }: { value: RoleCriticality }) {
  const { t } = useTranslation();
  return (
    <Badge color={CRITICALITY_COLORS[value]} variant="light" style={{ minWidth: "max-content" }}>
      {t(`succession.criticality.${value}`)}
    </Badge>
  );
}

export function RetentionRiskBadge({ value }: { value: RetentionRisk }) {
  const { t } = useTranslation();
  return (
    <Badge color={RISK_COLORS[value]} variant="light" style={{ minWidth: "max-content" }}>
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
