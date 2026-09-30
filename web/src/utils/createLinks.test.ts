import { describe, expect, test } from "vitest";
import { feedbackCreateLink, feedbackProvideLink } from "./feedbackLinks";
import { goalCreateLink } from "./goalLinks";
import { oneOnOneCreateLink } from "./oneOnOneLinks";
import { impactEntryCreateLink } from "./impactLogLinks";
import { successionPlanCreateLink } from "./successionLinks";
import { teamKpiCreateLink } from "./teamKpiLinks";
import { daysOffCreateLink } from "./daysOffLinks";

const CANCEL = "/goals?tab=own";
const ENC = "%2Fgoals%3Ftab%3Down";

// The v4.6.0 `cancel=` sibling of `back=`: serialised last, encoded, and only when given.
describe("create-screen link builders carry an encoded cancel", () => {
  test("feedback", () => {
    expect(feedbackCreateLink()).toBe("/feedback/new");
    expect(feedbackCreateLink(undefined, CANCEL)).toBe(`/feedback/new?cancel=${ENC}`);
    expect(feedbackCreateLink("/feedback?tab=provided", CANCEL)).toBe(
      `/feedback/new?back=%2Ffeedback%3Ftab%3Dprovided&cancel=${ENC}`,
    );
    expect(feedbackProvideLink(4, "/users")).toBe("/feedback/new?subjectId=4&back=%2Fusers");
    expect(feedbackProvideLink(4, undefined, CANCEL)).toBe(`/feedback/new?subjectId=4&cancel=${ENC}`);
  });

  test("goal", () => {
    expect(goalCreateLink()).toBe("/goals/new");
    expect(goalCreateLink(undefined, "/goals?tab=managed", CANCEL)).toBe(
      `/goals/new?back=%2Fgoals%3Ftab%3Dmanaged&cancel=${ENC}`,
    );
    expect(goalCreateLink(3, undefined, CANCEL)).toBe(`/goals/new?subordinateId=3&cancel=${ENC}`);
  });

  test("one-on-one (subordinate now optional)", () => {
    expect(oneOnOneCreateLink()).toBe("/one-on-ones/new");
    expect(oneOnOneCreateLink(5, "/x")).toBe("/one-on-ones/new?subordinateId=5&back=%2Fx");
    expect(oneOnOneCreateLink(undefined, undefined, CANCEL)).toBe(`/one-on-ones/new?cancel=${ENC}`);
  });

  test("impact entry, succession plan, team KPI, days off", () => {
    expect(impactEntryCreateLink("/impact-log", CANCEL)).toBe(
      `/impact-log/new?back=%2Fimpact-log&cancel=${ENC}`,
    );
    expect(impactEntryCreateLink()).toBe("/impact-log/new");
    expect(successionPlanCreateLink(undefined, CANCEL)).toBe(`/succession/new?cancel=${ENC}`);
    expect(teamKpiCreateLink(undefined, "/team-kpis?tab=managed", CANCEL)).toBe(
      `/team-kpis/new?back=%2Fteam-kpis%3Ftab%3Dmanaged&cancel=${ENC}`,
    );
    expect(teamKpiCreateLink(2)).toBe("/team-kpis/new?teamId=2");
    expect(daysOffCreateLink("/days-off?tab=team", true, CANCEL)).toBe(
      `/days-off/new?onBehalf=1&back=%2Fdays-off%3Ftab%3Dteam&cancel=${ENC}`,
    );
    expect(daysOffCreateLink()).toBe("/days-off/new");
  });
});
