import { definePerfScreen, type PerfCase } from "./harness";

// The landing page `/` (web/src/pages/Dashboard.tsx) — mirrors perf/k6/dashboard.js: the hero tiles
// (dashboard/summary) over four tabs. Direct-navigating with `?tab=` measures each tab as a first load of that tab
// (an explicit ?tab= wins over the remembered one); `managers` is what a fresh browser lands on. A persona only loads the
// tabs the SPA gives its role: an IC has no reports (subordinates tab is empty by construction) and manages no team.
const SUMMARY = /\/api\/v1\/dashboard\/summary/;
const MANAGERS = /\/api\/v1\/teams\/members\?[^ ]*view=managers/;
const PEERS = /\/api\/v1\/teams\/members\?[^ ]*view=member/;
const MANAGED = /\/api\/v1\/teams\/members\?[^ ]*view=managed/;
const TEAMS = /\/api\/v1\/teams\?/;

const tab = (persona: PerfCase["persona"], name: string, expectApi: RegExp[]): PerfCase => ({
  persona,
  label: `${persona}.${name}`,
  path: `/?tab=${name}`,
  expectApi: [SUMMARY, ...expectApi],
});

definePerfScreen("dashboard", [
  ...(["ceo", "director", "lead", "ic", "hr", "admin"] as const).map((p) => tab(p, "managers", [MANAGERS])),
  ...(["ceo", "lead", "ic"] as const).map((p) => tab(p, "peers", [PEERS, TEAMS])),
  ...(["ceo", "director", "lead"] as const).map((p) => tab(p, "subordinates", [MANAGED, TEAMS])),
  ...(["ceo", "lead"] as const).map((p) => tab(p, "myTeams", [TEAMS])),
]);
