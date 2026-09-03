import type { RetentionRisk, RoleCriticality } from "../api/successionPlans";

// The succession severity scales' single color source, shared by the badges
// (SuccessionBadges.tsx) and the definition sliders (SuccessionPlanFields.tsx) — its own
// module for the Fast-Refresh only-export-components rule (the personCardSupport split).
// Palette rules: red/orange grade severity (the ratingColor direction), teal = the good side
// (never brand green), gray = neutral. Bare hues only (v3.3.0): the light pills take their
// AA ink from the hue map in themeVariables.ts, a shade suffix would bypass it.

export const CRITICALITY_COLORS: Record<RoleCriticality, string> = {
  CRITICAL: "red",
  CORE: "orange",
  STANDARD: "gray",
};

export const RISK_COLORS: Record<RetentionRisk, string> = {
  HIGH: "orange",
  MEDIUM: "yellow",
  LOW: "teal",
};
