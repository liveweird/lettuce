import { definePerfScreen, type PerfCase } from "./harness";

// The activity log (web/src/pages/ActivityLog.tsx, UserActivity.tsx, components/ActivityFeed.tsx) — mirrors
// perf/k6/activity-log.js: a query-time UNION ALL over the event trails. `own` for everyone, the report's log for a manager in
// the chain (perf-ic-0001), and HR's audit read of the CEO's log — the widest one of the org.
const ACTIVITY = /\/api\/v1\/users\/\d+\/activity\?/;

const own = (persona: PerfCase["persona"]): PerfCase => ({ persona, label: `${persona}.own`, path: "/activity", expectApi: [ACTIVITY] });

definePerfScreen("activity-log", [
  own("ceo"), own("director"), own("lead"), own("ic"), own("hr"), own("admin"),
  ...(["ceo", "director", "lead"] as const).map(
    (persona): PerfCase => ({
      persona,
      label: `${persona}.report`,
      path: async ({ userIdOf }) => `/users/${await userIdOf("ic")}/activity`,
      expectApi: [ACTIVITY],
    }),
  ),
  {
    persona: "hr",
    label: "hr.audit",
    path: async ({ userIdOf }) => `/users/${await userIdOf("ceo")}/activity?mode=audit`,
    expectApi: [ACTIVITY],
  },
]);
