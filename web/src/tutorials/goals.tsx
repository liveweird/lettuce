// The "How goals work" tutorial (v3.15.0) — a short, role-filtered walkthrough over the Goals
// area's own chrome. It only navigates and spotlights stable chrome (tabs, header buttons, form
// controls, dashboard cards); it never opens a real goal and needs no data to exist. See
// "Feature tutorials" in web/CLAUDE.md for the recipe this follows.
import { Stack, Text } from "@mantine/core";
import GoalLifecycle from "../components/GoalLifecycle";
import type { TourStepDef } from "../components/tourSupport";
import { goalCreateLink } from "../utils/goalLinks";
import type { TutorialDef } from "./types";

// The create form's URL from the Goals hub's own manager "New goal" entry point — reused by
// both steps that spotlight the form (never hand-assembled, per web/CLAUDE.md's link-builder rule).
const FORM_URL = goalCreateLink(undefined, "/goals?tab=managed");

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.goals.steps.intro",
    placement: "center",
    feature: "GOALS",
  },
  {
    target: "body",
    contentKey: "tutorials.goals.steps.lifecycle",
    placement: "center",
    feature: "GOALS",
    // The app's own lifecycle diagram (components/GoalLifecycle.tsx), rendered with no
    // `currentStatus` — this step is a concept explainer, not tied to any real goal.
    render: (text) => (
      <Stack gap="sm">
        <Text size="sm">{text}</Text>
        <GoalLifecycle />
      </Stack>
    ),
  },
  {
    target: '[data-tour="goals-own"]',
    contentKey: "tutorials.goals.steps.own",
    placement: "bottom",
    navTo: "/goals?tab=own",
    feature: "GOALS",
  },
  {
    target: '[data-tour="goals-filters"]',
    contentKey: "tutorials.goals.steps.filters",
    placement: "bottom",
    navTo: "/goals?tab=own",
    feature: "GOALS",
  },
  {
    target: "body",
    contentKey: "tutorials.goals.steps.progress",
    placement: "center",
    feature: "GOALS",
  },
  {
    target: '[data-tour="goals-managed"]',
    contentKey: "tutorials.goals.steps.managed",
    placement: "bottom",
    navTo: "/goals?tab=managed",
    managerOnly: true,
    feature: "GOALS",
  },
  {
    target: '[data-tour="goals-new"]',
    contentKey: "tutorials.goals.steps.new",
    placement: "bottom",
    navTo: "/goals?tab=managed",
    managerOnly: true,
    feature: "GOALS",
  },
  {
    target: '[data-tour="goals-definition"]',
    contentKey: "tutorials.goals.steps.definition",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "GOALS",
  },
  {
    target: '[data-tour="goals-form-actions"]',
    contentKey: "tutorials.goals.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "GOALS",
  },
  {
    target: "body",
    contentKey: "tutorials.goals.steps.manage",
    placement: "center",
    managerOnly: true,
    feature: "GOALS",
  },
  {
    target: '[data-tour="dashboard-subordinates"]',
    contentKey: "tutorials.goals.steps.subordinates",
    placement: "bottom",
    navTo: "/?tab=subordinates",
    managerOnly: true,
    feature: "GOALS",
  },
  {
    target: '[data-tour="dashboard-managers"]',
    contentKey: "tutorials.goals.steps.managers",
    placement: "bottom",
    navTo: "/?tab=managers",
    feature: "GOALS",
  },
];

export const GOALS_TUTORIAL: TutorialDef = {
  id: "goals",
  feature: "GOALS",
  home: "/goals?tab=own",
  steps: STEPS,
};
