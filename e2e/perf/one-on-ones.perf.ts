import { definePerfScreen, type PerfCase } from "./harness";

// /one-on-ones (web/src/pages/OneOnOnes.tsx, OneOnOneTable.tsx, ViewOneOnOne.tsx) — mirrors perf/k6/one-on-ones.js: the biggest
// tables of the dataset (~130k meetings, ~800k notes + action items). The `managed`/`team` tabs exist only for managers
// (the SPA falls back to `own` otherwise), HR's auditor view lives in the per-person drill-down (?mode=audit).
const list = (view: string) => new RegExp(`/api/v1/one-on-ones\\?[^ ]*view=${view}`);

const tab = (persona: PerfCase["persona"], name: "own" | "managed" | "team"): PerfCase => ({
  persona,
  label: `${persona}.${name}`,
  path: `/one-on-ones?tab=${name}`,
  expectApi: [list(name)],
});

// The meeting holding the deepest action-item carry-over chain of dataset v2 (6 links) — pinned in perf/k6/one-on-ones.js
// (LONG_CHAIN_MEETING); a new DATASET_VERSION needs a re-pick there and here.
const LONG_CHAIN_MEETING = 97111;

definePerfScreen("one-on-ones", [
  tab("ceo", "own"), tab("ceo", "managed"), tab("ceo", "team"),
  tab("director", "managed"), tab("director", "team"),
  tab("lead", "own"), tab("lead", "managed"), tab("lead", "team"),
  tab("ic", "own"),
  tab("hr", "own"),
  {
    persona: "ceo",
    label: "ceo.detail-chain",
    path: `/one-on-ones/${LONG_CHAIN_MEETING}/view`,
    expectApi: [new RegExp(`/api/v1/one-on-ones/${LONG_CHAIN_MEETING}(\\?|$)`)],
  },
  // The per-person drill-down: the report's manager (view=with) and HR's audit read of the same person (view=user).
  {
    persona: "lead",
    label: "lead.drilldown",
    path: async ({ userIdOf }) => `/users/${await userIdOf("ic")}/one-on-ones`,
    expectApi: [list("with")],
  },
  {
    persona: "hr",
    label: "hr.drilldown-audit",
    path: async ({ userIdOf }) => `/users/${await userIdOf("ic")}/one-on-ones?mode=audit`,
    expectApi: [list("user")],
  },
]);
