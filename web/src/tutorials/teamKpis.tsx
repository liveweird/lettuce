// The "How team KPIs work" tutorial (v3.20.0) — a short, role-filtered walkthrough over the
// team KPIs area's own chrome. It only navigates and spotlights stable chrome (tabs, header
// buttons, form controls, dashboard cards); it never opens a real KPI and needs no data to
// exist. The lifecycle diagram and its four actions need no real KPI either — they render the
// generalised `components/GoalLifecycle.tsx` with `keyPrefix="teamKpi"` (the same diagram the
// KPI view page's own Lifecycle tab shows). The KPI data and Graph tabs need a real KPI to open,
// so they stay body (concept) steps like the goals tutorial's progress step. See "Feature
// tutorials" in web/CLAUDE.md for the recipe this follows.
import { Stack, Text } from "@mantine/core";
import GoalLifecycle from "../components/GoalLifecycle";
import type { TourStepDef } from "../components/tourSupport";
import { teamKpiCreateLink } from "../utils/teamKpiLinks";
import type { TutorialDef } from "./types";

// The create form's URL from the Team KPIs hub's own manager "New team KPI" entry point — never
// prefilled with a team (a picked team arms the discard guard, which would prompt while the
// tutorial navigates away from the form).
const FORM_URL = teamKpiCreateLink(undefined, "/team-kpis?tab=managed");

const STEPS: readonly TourStepDef[] = [
  {
    target: "body",
    contentKey: "tutorials.teamKpis.steps.intro",
    placement: "center",
    feature: "TEAM_KPIS",
  },
  {
    target: "body",
    contentKey: "tutorials.teamKpis.steps.lifecycle",
    placement: "center",
    feature: "TEAM_KPIS",
    // The app's own lifecycle diagram (components/GoalLifecycle.tsx), generalised by keyPrefix
    // (the GoalCloseModal precedent) — rendered with no `currentStatus`, since this step is a
    // concept explainer, not tied to any real KPI.
    render: (text) => (
      <Stack gap="sm">
        <Text size="sm">{text}</Text>
        <GoalLifecycle keyPrefix="teamKpi" />
      </Stack>
    ),
  },
  {
    target: '[data-tour="team-kpis-own"]',
    contentKey: "tutorials.teamKpis.steps.own",
    placement: "bottom",
    navTo: "/team-kpis?tab=own",
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-filters"]',
    contentKey: "tutorials.teamKpis.steps.filters",
    placement: "bottom",
    navTo: "/team-kpis?tab=own",
    feature: "TEAM_KPIS",
  },
  {
    target: "body",
    contentKey: "tutorials.teamKpis.steps.data",
    placement: "center",
    feature: "TEAM_KPIS",
  },
  {
    target: "body",
    contentKey: "tutorials.teamKpis.steps.graph",
    placement: "center",
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-managed"]',
    contentKey: "tutorials.teamKpis.steps.managed",
    placement: "bottom",
    navTo: "/team-kpis?tab=managed",
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-managed-filters"]',
    contentKey: "tutorials.teamKpis.steps.managedFilters",
    placement: "bottom",
    navTo: "/team-kpis?tab=managed",
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-new"]',
    contentKey: "tutorials.teamKpis.steps.new",
    placement: "bottom",
    navTo: "/team-kpis?tab=managed",
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-definition"]',
    contentKey: "tutorials.teamKpis.steps.definition",
    placement: "bottom",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-form-actions"]',
    contentKey: "tutorials.teamKpis.steps.actions",
    placement: "top",
    navTo: FORM_URL,
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: "body",
    contentKey: "tutorials.teamKpis.steps.lifecycleActions",
    placement: "center",
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="dashboard-myTeams"]',
    contentKey: "tutorials.teamKpis.steps.myTeams",
    placement: "bottom",
    navTo: "/?tab=myTeams",
    managerOnly: true,
    feature: "TEAM_KPIS",
  },
  {
    target: '[data-tour="team-kpis-own"]',
    contentKey: "tutorials.teamKpis.steps.end",
    placement: "bottom",
    navTo: "/team-kpis?tab=own",
    feature: "TEAM_KPIS",
  },
];

export const TEAM_KPIS_TUTORIAL: TutorialDef = {
  id: "teamKpis",
  feature: "TEAM_KPIS",
  home: "/team-kpis?tab=own",
  steps: STEPS,
};
