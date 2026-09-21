// The "How succession plans work" tutorial (v3.22.0) — a short, role-filtered walkthrough over
// the succession-plans area's own chrome. It only navigates and spotlights stable chrome (tabs,
// header buttons, form controls, dashboard cards); it never opens a real plan and needs no data
// to exist. The Review screen and the nomination editor need a real plan to open, so nominations,
// the review flow and the access model stay body (concept) steps — the shared closing step
// re-spotlights My plans. See "Feature tutorials" in web/CLAUDE.md for the recipe this follows.
import type { TourStepDef } from "../components/tourSupport";
import type { TutorialDef } from "./types";
import { successionPlanCreateLink } from "../utils/successionLinks";

// The create screen accepts no person id in its URL (identity is never carried in the URL,
// v2.35.0) — the form's own Select picks the report, so FORM_URL never seeds a person.
const FORM_URL = successionPlanCreateLink("/succession?tab=own");

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.succession.steps.intro",
    placement: "center",
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-own"]',
    contentKey: "tutorials.succession.steps.own",
    placement: "bottom",
    navTo: "/succession?tab=own",
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-filters"]',
    contentKey: "tutorials.succession.steps.filters",
    placement: "bottom",
    navTo: "/succession?tab=own",
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-team"]',
    contentKey: "tutorials.succession.steps.team",
    placement: "bottom",
    navTo: "/succession?tab=team",
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-new"]',
    contentKey: "tutorials.succession.steps.new",
    placement: "bottom",
    navTo: "/succession?tab=own",
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-form-seat"]',
    contentKey: "tutorials.succession.steps.seat",
    placement: "bottom",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-form-loss-impact"]',
    contentKey: "tutorials.succession.steps.lossImpact",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-form-actions"]',
    contentKey: "tutorials.succession.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: "body",
    contentKey: "tutorials.succession.steps.nominations",
    placement: "center",
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: "body",
    contentKey: "tutorials.succession.steps.review",
    placement: "center",
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: "body",
    contentKey: "tutorials.succession.steps.access",
    placement: "center",
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="dashboard-subordinates"]',
    contentKey: "tutorials.succession.steps.subordinates",
    placement: "bottom",
    navTo: "/?tab=subordinates",
    managerOnly: true,
    feature: "SUCCESSION_PLANS",
  },
  {
    target: '[data-tour="succession-own"]',
    contentKey: "tutorials.succession.steps.end",
    placement: "bottom",
    navTo: "/succession?tab=own",
    feature: "SUCCESSION_PLANS",
  },
];

export const SUCCESSION_TUTORIAL: TutorialDef = {
  id: "succession",
  feature: "SUCCESSION_PLANS",
  home: "/succession?tab=own",
  steps: STEPS,
};
