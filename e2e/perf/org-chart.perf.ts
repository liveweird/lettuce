import { definePerfScreen, type PerfCase } from "./harness";

// The org chart /org (web/src/pages/OrgChart.tsx) — the `org-chart` screen of perf/k6/users-admin.js: teams listAll, then ONE
// GET teams/<id> per team (~84) and the users listAll loop, all at once; then the chart's own layout. Open to every
// authenticated user (no client gate), measured for the admin, an IC and the CEO.
const chart = (persona: PerfCase["persona"]): PerfCase => ({
  persona,
  label: persona,
  path: "/org",
  expectApi: [/\/api\/v1\/teams\?/, /\/api\/v1\/teams\/\d+/, /\/api\/v1\/users\?/],
});

definePerfScreen("org-chart", [chart("admin"), chart("ic"), chart("ceo")]);
