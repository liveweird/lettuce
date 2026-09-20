// The "How days off work" tutorial (v3.16.0) — a short, role-filtered walkthrough over the Days
// off area's own chrome. Unlike feedbacks/goals there is no lifecycle since v3.9.0 (an entry is
// recorded and deleted, nobody approves it), so the only concept step is the intro — the budget
// card, the calendar grid and the create form carry the substance instead. It only navigates and
// spotlights stable chrome; it never opens a real entry and needs no data to exist. See "Feature
// tutorials" in web/CLAUDE.md for the recipe this follows.
import type { TourStepDef } from "../components/tourSupport";
import { daysOffCreateLink, daysOffListLink } from "../utils/daysOffLinks";
import type { TutorialDef } from "./types";

const CALENDAR = daysOffListLink("calendar");
const REQUESTS = daysOffListLink("requests");
const TEAM = daysOffListLink("team");
// The create form's URL from the Days-off hub's own "New days off" entry point — self mode only,
// never on-behalf (never hand-assembled, per web/CLAUDE.md's link-builder rule).
const FORM_URL = daysOffCreateLink(REQUESTS);

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.daysOff.steps.intro",
    placement: "center",
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-calendar"]',
    contentKey: "tutorials.daysOff.steps.calendar",
    placement: "bottom",
    navTo: CALENDAR,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-calendar-scope"]',
    contentKey: "tutorials.daysOff.steps.scope",
    placement: "bottom",
    navTo: CALENDAR,
    managerOnly: true,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-month"]',
    contentKey: "tutorials.daysOff.steps.month",
    placement: "bottom",
    navTo: CALENDAR,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-requests"]',
    contentKey: "tutorials.daysOff.steps.requests",
    placement: "bottom",
    navTo: REQUESTS,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-budget"]',
    contentKey: "tutorials.daysOff.steps.budget",
    placement: "bottom",
    navTo: REQUESTS,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-team"]',
    contentKey: "tutorials.daysOff.steps.team",
    placement: "bottom",
    navTo: TEAM,
    managerOnly: true,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-team-view"]',
    contentKey: "tutorials.daysOff.steps.teamView",
    placement: "bottom",
    navTo: TEAM,
    managerOnly: true,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-record"]',
    contentKey: "tutorials.daysOff.steps.record",
    placement: "bottom",
    navTo: TEAM,
    managerOnly: true,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-new"]',
    contentKey: "tutorials.daysOff.steps.new",
    placement: "bottom",
    navTo: REQUESTS,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-form"]',
    contentKey: "tutorials.daysOff.steps.form",
    placement: "bottom",
    navTo: FORM_URL,
    feature: "DAYS_OFF",
  },
  {
    target: '[data-tour="days-off-form-actions"]',
    contentKey: "tutorials.daysOff.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    feature: "DAYS_OFF",
  },
];

export const DAYS_OFF_TUTORIAL: TutorialDef = {
  id: "daysOff",
  feature: "DAYS_OFF",
  home: REQUESTS,
  steps: STEPS,
};
