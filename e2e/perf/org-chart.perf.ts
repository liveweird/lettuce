import { definePerfScreen, type PerfCase } from "./harness";

// The org chart /org (web/src/pages/OrgChart.tsx) — the `org-chart` screen of perf/k6/users-admin.js: teams listAll (rows carry
// memberIds since v4.14.0 — no per-team GET) in parallel with the users listAll loop; then the chart's own layout. Open to every
// authenticated user (no client gate), measured for the admin, an IC and the CEO.
const chart = (persona: PerfCase["persona"]): PerfCase => ({
  persona,
  label: persona,
  path: "/org",
  expectApi: [/\/api\/v1\/teams\?/, /\/api\/v1\/users\?/],
});

definePerfScreen("org-chart", [chart("admin"), chart("ic"), chart("ceo")]);
