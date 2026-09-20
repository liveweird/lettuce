// The "How performance reviews work" tutorial (v3.17.0) — a short, role-filtered walkthrough
// over the Performance area's own chrome. It only navigates and spotlights stable chrome (tabs,
// header buttons, form controls, dashboard toggles); it never opens a real review and needs no
// data to exist. See "Feature tutorials" in web/CLAUDE.md for the recipe this follows.
import { Stack, Text } from "@mantine/core";
import ReviewLifecycle from "../components/ReviewLifecycle";
import type { TourStepDef } from "../components/tourSupport";
import { reviewCreateLink } from "../utils/performanceReviewLinks";
import type { TutorialDef } from "./types";

// The create form's URL from the Performance hub's own "New review" entry point — reused by
// both steps that spotlight the form (never hand-assembled, per web/CLAUDE.md's link-builder rule).
const FORM_URL = reviewCreateLink(undefined, "/performance?tab=managed");

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.performanceReviews.steps.intro",
    placement: "center",
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: "body",
    contentKey: "tutorials.performanceReviews.steps.lifecycle",
    placement: "center",
    feature: "PERFORMANCE_REVIEWS",
    // The app's own lifecycle diagram (components/ReviewLifecycle.tsx), rendered with no
    // `currentStatus` — this step is a concept explainer, not tied to any real review.
    render: (text) => (
      <Stack gap="sm">
        <Text size="sm">{text}</Text>
        <ReviewLifecycle />
      </Stack>
    ),
  },
  {
    target: '[data-tour="performance-own"]',
    contentKey: "tutorials.performanceReviews.steps.own",
    placement: "bottom",
    navTo: "/performance?tab=own",
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-filters"]',
    contentKey: "tutorials.performanceReviews.steps.filters",
    placement: "bottom",
    navTo: "/performance?tab=own",
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: "body",
    contentKey: "tutorials.performanceReviews.steps.categories",
    placement: "center",
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-managed"]',
    contentKey: "tutorials.performanceReviews.steps.managed",
    placement: "bottom",
    navTo: "/performance?tab=managed",
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-period"]',
    contentKey: "tutorials.performanceReviews.steps.period",
    placement: "bottom",
    navTo: "/performance?tab=managed",
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-view"]',
    contentKey: "tutorials.performanceReviews.steps.views",
    placement: "bottom",
    navTo: "/performance?tab=managed",
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-dashboard-filters"]',
    contentKey: "tutorials.performanceReviews.steps.dashboardFilters",
    placement: "bottom",
    navTo: "/performance?tab=managed",
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-dashboard"]',
    contentKey: "tutorials.performanceReviews.steps.new",
    placement: "top",
    navTo: "/performance?tab=managed",
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-form"]',
    contentKey: "tutorials.performanceReviews.steps.form",
    placement: "bottom",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="performance-form-actions"]',
    contentKey: "tutorials.performanceReviews.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: "body",
    contentKey: "tutorials.performanceReviews.steps.manage",
    placement: "center",
    managerOnly: true,
    feature: "PERFORMANCE_REVIEWS",
  },
  {
    target: '[data-tour="config-review-periods"]',
    contentKey: "tutorials.performanceReviews.steps.periods",
    placement: "bottom",
    navTo: "/review-periods",
    feature: "PERFORMANCE_REVIEWS",
  },
];

export const PERFORMANCE_REVIEWS_TUTORIAL: TutorialDef = {
  id: "performanceReviews",
  feature: "PERFORMANCE_REVIEWS",
  home: "/performance?tab=own",
  steps: STEPS,
};
