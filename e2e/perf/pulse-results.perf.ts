import { definePerfScreen, type PerfCase } from "./harness";

// The Pulse hub /pulse (web/src/pages/Pulse*.tsx, components/PulseTeamResultCard.tsx) — mirrors perf/k6/pulse-results.js. The
// results tab fires one card per visible team in parallel (results + trend, + comments for monitors/HR): the HR auditor with
// no team of their own defaults to ALL ~80 teams, the most request-heavy screen of the SPA. The `participation` tab needs
// isManager or HR; the survey tab (the default) is a single form and not measured here.
const CYCLES = /\/api\/v1\/pulse-surveys\/cycles/;
const VISIBLE = /\/api\/v1\/pulse-surveys\/visible-teams/;
const PARTICIPATION = /\/api\/v1\/pulse-surveys\/cycles\/\d+\/participation-status/;

const tab = (persona: PerfCase["persona"], name: "results" | "trend" | "participation", expectApi: RegExp[]): PerfCase => ({
  persona,
  label: `${persona}.${name}`,
  path: `/pulse?tab=${name}`,
  expectApi,
});

definePerfScreen("pulse-results", [
  tab("hr", "results", [CYCLES, VISIBLE]), tab("hr", "trend", [VISIBLE]), tab("hr", "participation", [PARTICIPATION]),
  tab("ceo", "results", [CYCLES, VISIBLE]), tab("ceo", "participation", [PARTICIPATION]),
  tab("lead", "results", [CYCLES, VISIBLE]), tab("lead", "participation", [PARTICIPATION]),
  tab("ic", "results", [CYCLES, VISIBLE]),
]);
