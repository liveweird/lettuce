import { definePerfScreen, type PerfCase } from "./harness";

// /days-off (web/src/pages/DaysOff.tsx) — mirrors perf/k6/days-off.js. The calendar is the default tab; `?scope=` deep-links a
// calendar scope (it wins over the stored pick when the role may use it: managed/managedAll need a managed team, org needs
// HR). The request pattern carries the scope so a first member-scope render (before the managed-teams probe resolves) cannot
// count as the settled screen. `requests` = the caller's own budgets + entries; `team` = managers' entries.
const calendar = (scope: string) => new RegExp(`/api/v1/days-off/calendar\\?[^ ]*scope=${scope}`);
const OWN_BUDGETS = /\/api\/v1\/days-off\/budgets\?[^ ]*view=own/;
const OWN_ENTRIES = /\/api\/v1\/days-off\?[^ ]*view=own/;
const TEAM_ENTRIES = /\/api\/v1\/days-off\?[^ ]*view=managed/;

const cal = (persona: PerfCase["persona"], scope: "member" | "managed" | "managedAll" | "org" | "shared"): PerfCase => ({
  persona,
  label: `${persona}.calendar-${scope}`,
  path: scope === "member" ? "/days-off" : `/days-off?scope=${scope}`,
  // managedAll is the SPA's includeIndirect pick of the API scope `managed`.
  expectApi: [calendar(scope === "managedAll" ? "managed" : scope)],
});

const tab = (persona: PerfCase["persona"], name: "requests" | "team", expectApi: RegExp[]): PerfCase => ({
  persona,
  label: `${persona}.${name}`,
  path: `/days-off?tab=${name}`,
  expectApi,
});

definePerfScreen("days-off", [
  cal("ceo", "member"), cal("ceo", "managedAll"),
  cal("director", "member"), cal("director", "managedAll"),
  cal("lead", "member"), cal("lead", "managed"),
  cal("ic", "member"), cal("ic", "shared"),
  cal("hr", "member"), cal("hr", "org"),
  cal("admin", "member"),
  tab("ceo", "requests", [OWN_BUDGETS, OWN_ENTRIES]), tab("ceo", "team", [TEAM_ENTRIES]),
  tab("lead", "requests", [OWN_BUDGETS, OWN_ENTRIES]), tab("lead", "team", [TEAM_ENTRIES]),
  tab("ic", "requests", [OWN_BUDGETS, OWN_ENTRIES]),
]);
