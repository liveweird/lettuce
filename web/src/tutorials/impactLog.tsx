// The "How the impact log works" tutorial (v3.19.0) — a short, role-filtered walkthrough over
// the impact log area's own chrome. It only navigates and spotlights stable chrome (tabs, header
// buttons, form controls, dashboard cards); it never opens a real entry and needs no data to
// exist. The view page needs a real entry to open, so it stays a body (concept) step instead of
// an anchored one — the shared closing step re-spotlights My journal. See "Feature tutorials" in
// web/CLAUDE.md for the recipe this follows.
import type { TourStepDef } from "../components/tourSupport";
import type { TutorialDef } from "./types";
import { impactEntryCreateLink } from "../utils/impactLogLinks";

const FORM_URL = impactEntryCreateLink("/impact-log?tab=own");

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.impactLog.steps.intro",
    placement: "center",
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-own"]',
    contentKey: "tutorials.impactLog.steps.own",
    placement: "bottom",
    navTo: "/impact-log?tab=own",
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-filters"]',
    contentKey: "tutorials.impactLog.steps.filters",
    placement: "bottom",
    navTo: "/impact-log?tab=own",
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-new"]',
    contentKey: "tutorials.impactLog.steps.new",
    placement: "bottom",
    navTo: "/impact-log?tab=own",
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-form-header"]',
    contentKey: "tutorials.impactLog.steps.header",
    placement: "bottom",
    navTo: FORM_URL,
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-form-steps"]',
    contentKey: "tutorials.impactLog.steps.steps",
    placement: "bottom",
    navTo: FORM_URL,
    feature: "IMPACT_LOG",
  },
  {
    target: "body",
    contentKey: "tutorials.impactLog.steps.sections",
    placement: "center",
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-form-actions"]',
    contentKey: "tutorials.impactLog.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-managed"]',
    contentKey: "tutorials.impactLog.steps.managed",
    placement: "bottom",
    navTo: "/impact-log?tab=managed",
    managerOnly: true,
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-managed-filters"]',
    contentKey: "tutorials.impactLog.steps.managedFilters",
    placement: "bottom",
    navTo: "/impact-log?tab=managed",
    managerOnly: true,
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="dashboard-subordinates"]',
    contentKey: "tutorials.impactLog.steps.subordinates",
    placement: "bottom",
    navTo: "/?tab=subordinates",
    managerOnly: true,
    feature: "IMPACT_LOG",
  },
  {
    target: '[data-tour="impact-log-own"]',
    contentKey: "tutorials.impactLog.steps.entry",
    placement: "bottom",
    navTo: "/impact-log?tab=own",
    feature: "IMPACT_LOG",
  },
];

export const IMPACT_LOG_TUTORIAL: TutorialDef = {
  id: "impactLog",
  feature: "IMPACT_LOG",
  home: "/impact-log?tab=own",
  steps: STEPS,
};
