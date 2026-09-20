// The "How 1:1 meetings work" tutorial (v3.18.0) — a short, role-filtered walkthrough over the
// 1:1 meetings area's own chrome. It only navigates and spotlights stable chrome (tabs, header
// buttons, form controls, dashboard cards); it never opens a real meeting and needs no data to
// exist. The editor needs a real meeting to open, so the document shape, the carry-over rule and
// editing are body (concept) steps instead of anchored ones. See "Feature tutorials" in
// web/CLAUDE.md for the recipe this follows.
import type { TourStepDef } from "../components/tourSupport";
import type { TutorialDef } from "./types";

// oneOnOneCreateLink(subordinateId, back?) requires a subordinateId — there is no
// subordinate-less variant to reuse here (unlike goalCreateLink/reviewCreateLink), so the form
// steps spotlight the hub header's own "New 1:1" target instead of a hand-assembled URL.
const FORM_URL = "/one-on-ones/new";

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.oneOnOnes.steps.intro",
    placement: "center",
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-own"]',
    contentKey: "tutorials.oneOnOnes.steps.own",
    placement: "bottom",
    navTo: "/one-on-ones?tab=own",
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-filters"]',
    contentKey: "tutorials.oneOnOnes.steps.filters",
    placement: "bottom",
    navTo: "/one-on-ones?tab=own",
    feature: "ONE_ON_ONES",
  },
  {
    target: "body",
    contentKey: "tutorials.oneOnOnes.steps.document",
    placement: "center",
    feature: "ONE_ON_ONES",
  },
  {
    target: "body",
    contentKey: "tutorials.oneOnOnes.steps.carryOver",
    placement: "center",
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-managed"]',
    contentKey: "tutorials.oneOnOnes.steps.managed",
    placement: "bottom",
    navTo: "/one-on-ones?tab=managed",
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-team"]',
    contentKey: "tutorials.oneOnOnes.steps.team",
    placement: "bottom",
    navTo: "/one-on-ones?tab=team",
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-new"]',
    contentKey: "tutorials.oneOnOnes.steps.new",
    placement: "bottom",
    navTo: "/one-on-ones?tab=managed",
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-form"]',
    contentKey: "tutorials.oneOnOnes.steps.form",
    placement: "bottom",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="one-on-one-form-actions"]',
    contentKey: "tutorials.oneOnOnes.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: "body",
    contentKey: "tutorials.oneOnOnes.steps.edit",
    placement: "center",
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="dashboard-subordinates"]',
    contentKey: "tutorials.oneOnOnes.steps.subordinates",
    placement: "bottom",
    navTo: "/?tab=subordinates",
    managerOnly: true,
    feature: "ONE_ON_ONES",
  },
  {
    target: '[data-tour="dashboard-managers"]',
    contentKey: "tutorials.oneOnOnes.steps.managers",
    placement: "bottom",
    navTo: "/?tab=managers",
    feature: "ONE_ON_ONES",
  },
];

export const ONE_ON_ONES_TUTORIAL: TutorialDef = {
  id: "oneOnOnes",
  feature: "ONE_ON_ONES",
  home: "/one-on-ones?tab=own",
  steps: STEPS,
};
