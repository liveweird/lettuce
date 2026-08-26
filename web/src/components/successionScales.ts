import type { RetentionRisk, RoleCriticality } from "../api/successionPlans";

// The succession severity scales' single color source, shared by the badges
// (SuccessionBadges.tsx) and the definition sliders (SuccessionPlanFields.tsx) — its own
// module for the Fast-Refresh only-export-components rule (the personCardSupport split).
// Palette rules: red/orange grade severity (the ratingColor direction), teal = the good side
// (never brand green), gray = neutral.

export const CRITICALITY_COLORS: Record<RoleCriticality, string> = {
  CRITICAL: "red.7",
  CORE: "orange.6",
  STANDARD: "gray.6",
};

export const RISK_COLORS: Record<RetentionRisk, string> = {
  HIGH: "orange.8",
  MEDIUM: "yellow.6",
  LOW: "teal",
};
