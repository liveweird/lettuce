// The "How pulse surveys work" tutorial (v3.21.0) — the FIRST three-audience per-feature
// tutorial: every employee answers, managers (or HR) additionally monitor participation, and
// ADMINs additionally run the cycles. It only navigates and spotlights stable chrome (the hub's
// four tabs, the admin registry page's cards/table); it never opens a real cycle and needs no
// data to exist. A fresh DB has no pulse cycle and at most one non-terminal cycle exists
// org-wide, so nothing cycle-dependent is anchored: the survey wizard, the results cards, the
// cycle pickers and the trend chart are all body (concept) steps instead. No lifecycle diagram
// — the cycle machine (Scheduled → Open → Closed, Cancelled from anywhere) is an admin registry,
// described in copy rather than rendered. See "Feature tutorials" in web/CLAUDE.md for the
// recipe this follows.
import type { TourStepDef } from "../components/tourSupport";
import type { TutorialDef } from "./types";

const HUB = "/pulse?tab=survey";

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.pulse.steps.intro",
    placement: "center",
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-survey"]',
    contentKey: "tutorials.pulse.steps.survey",
    placement: "bottom",
    navTo: "/pulse?tab=survey",
    feature: "PULSE_SURVEYS",
  },
  {
    target: "body",
    contentKey: "tutorials.pulse.steps.questions",
    placement: "center",
    feature: "PULSE_SURVEYS",
  },
  {
    target: "body",
    contentKey: "tutorials.pulse.steps.anonymity",
    placement: "center",
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-results"]',
    contentKey: "tutorials.pulse.steps.results",
    placement: "bottom",
    navTo: "/pulse?tab=results",
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-trend"]',
    contentKey: "tutorials.pulse.steps.trend",
    placement: "bottom",
    navTo: "/pulse?tab=trend",
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-participation"]',
    contentKey: "tutorials.pulse.steps.participation",
    placement: "bottom",
    navTo: "/pulse?tab=participation",
    managerOrHr: true,
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="config-pulse-cycles"]',
    contentKey: "tutorials.pulse.steps.cycles",
    placement: "bottom",
    navTo: "/pulse-cycles",
    adminOnly: true,
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-admin-settings"]',
    contentKey: "tutorials.pulse.steps.settings",
    placement: "bottom",
    navTo: "/pulse-cycles",
    adminOnly: true,
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-admin-schedule"]',
    contentKey: "tutorials.pulse.steps.schedule",
    placement: "bottom",
    navTo: "/pulse-cycles",
    adminOnly: true,
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-admin-cycles"]',
    contentKey: "tutorials.pulse.steps.registry",
    placement: "top",
    navTo: "/pulse-cycles",
    adminOnly: true,
    feature: "PULSE_SURVEYS",
  },
  {
    target: '[data-tour="pulse-survey"]',
    contentKey: "tutorials.pulse.steps.end",
    placement: "bottom",
    navTo: "/pulse?tab=survey",
    feature: "PULSE_SURVEYS",
  },
];

export const PULSE_TUTORIAL: TutorialDef = {
  id: "pulse",
  feature: "PULSE_SURVEYS",
  home: HUB,
  steps: STEPS,
};
