// The "How feedback works" tutorial (v3.14.0) — a short, role-filtered walkthrough over the
// Feedback area's own chrome. It only navigates and spotlights stable chrome (tabs, header
// buttons, form controls, nav links); it never opens a real feedback and needs no data to
// exist. See "Feature tutorials" in web/CLAUDE.md for the recipe this follows.
import { Stack, Text } from "@mantine/core";
import FeedbackLifecycle from "../components/FeedbackLifecycle";
import type { TourStepDef } from "../components/tourSupport";
import { feedbackCreateLink } from "../utils/feedbackLinks";
import type { TutorialDef } from "./types";

// The create form's URL from the Feedback hub's own "New feedback" entry point — reused by both
// steps that spotlight the form (never hand-assembled, per web/CLAUDE.md's link-builder rule).
const FORM_URL = feedbackCreateLink("/feedback?tab=provided");

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.feedbacks.steps.intro",
    placement: "center",
    feature: "FEEDBACKS",
  },
  {
    target: "body",
    contentKey: "tutorials.feedbacks.steps.lifecycle",
    placement: "center",
    feature: "FEEDBACKS",
    // The app's own lifecycle diagram (components/FeedbackLifecycle.tsx), rendered with no
    // `currentStatus` — this step is a concept explainer, not tied to any real feedback.
    render: (text) => (
      <Stack gap="sm">
        <Text size="sm">{text}</Text>
        <FeedbackLifecycle />
      </Stack>
    ),
  },
  {
    target: '[data-tour="feedback-received"]',
    contentKey: "tutorials.feedbacks.steps.received",
    placement: "bottom",
    navTo: "/feedback?tab=received",
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="feedback-provided"]',
    contentKey: "tutorials.feedbacks.steps.provided",
    placement: "bottom",
    navTo: "/feedback?tab=provided",
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="feedback-team"]',
    contentKey: "tutorials.feedbacks.steps.team",
    placement: "bottom",
    navTo: "/feedback?tab=team",
    managerOnly: true,
    feature: "FEEDBACKS",
  },
  // The manager's Reports scope lives inside the (not-always-mounted) filter panel body, so the
  // step anchors on the always-rendered Filters toggle instead (see FilterPanel's `tourId`).
  {
    target: '[data-tour="feedback-filters"]',
    contentKey: "tutorials.feedbacks.steps.teamScope",
    placement: "bottom",
    navTo: "/feedback?tab=team",
    managerOnly: true,
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="feedback-new"]',
    contentKey: "tutorials.feedbacks.steps.new",
    placement: "bottom",
    navTo: "/feedback?tab=provided",
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="feedback-setup"]',
    contentKey: "tutorials.feedbacks.steps.setup",
    placement: "bottom",
    navTo: FORM_URL,
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="feedback-actions"]',
    contentKey: "tutorials.feedbacks.steps.actions",
    placement: "bottom",
    navTo: FORM_URL,
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="dashboard-managers"]',
    contentKey: "tutorials.feedbacks.steps.ask",
    placement: "bottom",
    navTo: "/?tab=managers",
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="dashboard-subordinates"]',
    contentKey: "tutorials.feedbacks.steps.request",
    placement: "bottom",
    navTo: "/?tab=subordinates",
    managerOnly: true,
    feature: "FEEDBACKS",
  },
  {
    target: '[data-tour="nav-kudos"]',
    contentKey: "tutorials.feedbacks.steps.kudos",
    placement: "right",
    navTo: "/kudos",
    feature: "FEEDBACKS",
  },
];

export const FEEDBACKS_TUTORIAL: TutorialDef = {
  id: "feedbacks",
  feature: "FEEDBACKS",
  home: "/feedback?tab=received",
  steps: STEPS,
};
