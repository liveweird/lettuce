import "../test/withPolish";
import { afterEach, describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import i18n from "../i18n";
import type { ActivityArea, ActivityEntry } from "../api/activity";
import { activityDocumentKind, describeActivity, isDocumentArea, type ActivityContext } from "./describeActivity";

const entry = (
  area: ActivityArea,
  eventType: string,
  params: Record<string, string> = {},
  extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({
  id: `${area}:EVENT:1`,
  createdAt: 1,
  area,
  eventType,
  params,
  documentId: null,
  link: null,
  details: null,
  subjectUserId: null,
  subjectUserName: null,
  ...extra,
});

function ctxFor(lang: "en" | "pl", careerLabel?: ActivityContext["careerLabel"]): ActivityContext {
  return { t: i18n.getFixedT(lang) as unknown as TFunction, locale: lang, careerLabel };
}

// Every (area, eventType) pair the server can send, with representative content-free params.
const CASES: [ActivityArea, string, Record<string, string>][] = [
  ["FEEDBACK", "CREATED", { status: "DRAFT" }],
  ["FEEDBACK", "CREATED", { status: "SENT" }],
  ["FEEDBACK", "DELETED", {}],
  ["FEEDBACK", "STATUS_CHANGED", { from: "DRAFT", to: "SENT" }],
  ["FEEDBACK", "CONTENT_UPDATED", {}],
  ["FEEDBACK", "CONTENT_AND_VISIBILITY_UPDATED", {}],
  ["FEEDBACK", "VISIBILITY_CHANGED", { to: "PUBLIC" }],
  ["FEEDBACK", "REQUEST_EXPIRED", {}],
  ["GOAL", "CREATED", { type: "NUMBER" }],
  ["GOAL", "TITLE_CHANGED", {}],
  ["GOAL", "DESCRIPTION_CHANGED", {}],
  ["GOAL", "TYPE_CHANGED", { from: "NUMBER", to: "PERCENTAGE" }],
  ["GOAL", "TARGET_CHANGED", { from: "40.0", to: "50.0" }],
  ["GOAL", "TARGET_DIRECTION_CHANGED", { from: "AT_LEAST", to: "AT_MOST" }],
  ["GOAL", "DUE_DATE_CHANGED", { from: "2026-08-01", to: "2026-09-01" }],
  ["GOAL", "PROGRESS_UPDATED", { from: "10.0", to: "20.0" }],
  ["GOAL", "PROGRESS_COMMENTED", {}],
  ["GOAL", "ACHIEVED_CHANGED", { to: "true" }],
  ["GOAL", "MILESTONE_ADDED", { position: "1" }],
  ["GOAL", "MILESTONE_EDITED", { position: "1" }],
  ["GOAL", "MILESTONE_REMOVED", { position: "1" }],
  ["GOAL", "MILESTONE_COMPLETED", { position: "1" }],
  ["GOAL", "MILESTONE_REOPENED", { position: "1" }],
  ["GOAL", "STATUS_CHANGED", { from: "DRAFT", to: "ACTIVE" }],
  ["GOAL", "DELETED", {}],
  ["ONE_ON_ONE", "CREATED", { date: "2026-07-01", carriedOver: "2" }],
  ["ONE_ON_ONE", "DELETED", {}],
  ["ONE_ON_ONE", "DATE_CHANGED", { from: "2026-07-01", to: "2026-07-02" }],
  ["ONE_ON_ONE", "POINT_ADDED", { position: "1" }],
  ["ONE_ON_ONE", "POINT_EDITED", { position: "1" }],
  ["ONE_ON_ONE", "POINT_REMOVED", { position: "1" }],
  ["ONE_ON_ONE", "DECISION_ADDED", { position: "1" }],
  ["ONE_ON_ONE", "DECISION_EDITED", { position: "1" }],
  ["ONE_ON_ONE", "DECISION_REMOVED", { position: "1" }],
  ["ONE_ON_ONE", "ACTION_ITEM_ADDED", { position: "1" }],
  ["ONE_ON_ONE", "ACTION_ITEM_EDITED", { position: "1" }],
  ["ONE_ON_ONE", "ACTION_ITEM_REMOVED", { position: "1" }],
  ["ONE_ON_ONE", "ACTION_ITEM_RESOLVED", { position: "1" }],
  ["ONE_ON_ONE", "ACTION_ITEM_UNRESOLVED", { position: "1" }],
  ["ONE_ON_ONE", "ACTION_ITEM_DUE_DATE_CHANGED", { position: "1", from: "2026-07-01", to: "2026-07-09" }],
  ["ONE_ON_ONE", "ACTION_ITEM_OWNER_CHANGED", { position: "1", from: "MANAGER", to: "SUBORDINATE" }],
  ["PERFORMANCE_REVIEW", "CREATED", {}],
  ["PERFORMANCE_REVIEW", "RATING_CHANGED", { category: "ATTITUDE" }],
  ["PERFORMANCE_REVIEW", "SUMMARY_CHANGED", { category: "DELIVERY" }],
  ["PERFORMANCE_REVIEW", "STATUS_CHANGED", { from: "DRAFT", to: "CALIBRATION" }],
  ["PERFORMANCE_REVIEW", "DELETED", {}],
  ["IMPACT_LOG_ENTRY", "CREATED", { periodStart: "2026-07-01", periodEnd: "2026-07-31" }],
  ["IMPACT_LOG_ENTRY", "UPDATED", { changed: "title,evidence" }],
  ["IMPACT_LOG_ENTRY", "DELETED", {}],
  ["SUCCESSION_PLAN", "CREATED", { roleCriticality: "CRITICAL", retentionRisk: "HIGH", targetBenchDepth: "2" }],
  ["SUCCESSION_PLAN", "CRITICALITY_CHANGED", { from: "CRITICAL", to: "IMPORTANT" }],
  ["SUCCESSION_PLAN", "RISK_CHANGED", { from: "HIGH", to: "LOW" }],
  ["SUCCESSION_PLAN", "BENCH_DEPTH_CHANGED", { from: "1", to: "2" }],
  ["SUCCESSION_PLAN", "LOSS_IMPACT_CHANGED", {}],
  ["SUCCESSION_PLAN", "REVIEW_COMPLETED", {}],
  ["SUCCESSION_PLAN", "CLOSED", {}],
  ["SUCCESSION_PLAN", "DELETED", {}],
  ["SUCCESSION_PLAN", "NOMINATION_ADDED", { candidateName: "Cleo", readiness: "READY_SOON", nominationType: "PRIMARY" }],
  ["SUCCESSION_PLAN", "NOMINATION_UPDATED", { candidateName: "Cleo", changed: "readiness,goals" }],
  ["SUCCESSION_PLAN", "NOMINATION_REMOVED", { candidateName: "Cleo" }],
  ["SUCCESSION_PLAN", "PRIMARY_DEMOTED", { candidateName: "Cleo" }],
  ["TEAM_KPI", "CREATED", { type: "NUMBER" }],
  ["TEAM_KPI", "TITLE_CHANGED", {}],
  ["TEAM_KPI", "DESCRIPTION_CHANGED", {}],
  ["TEAM_KPI", "TYPE_CHANGED", { from: "NUMBER", to: "PERCENTAGE" }],
  ["TEAM_KPI", "TARGET_CHANGED", { from: "40.0", to: "50.0" }],
  ["TEAM_KPI", "TARGET_DIRECTION_CHANGED", { from: "AT_LEAST", to: "AT_MOST" }],
  ["TEAM_KPI", "VALUE_RECORDED", { value: "12.0", date: "2026-07-10" }],
  ["TEAM_KPI", "VALUE_CORRECTED", { fromValue: "12.0", fromDate: "2026-07-10", toValue: "13.0", toDate: "2026-07-11" }],
  ["TEAM_KPI", "VALUE_REMOVED", { value: "12.0", date: "2026-07-10" }],
  ["TEAM_KPI", "STATUS_CHANGED", { from: "DRAFT", to: "ACTIVE" }],
  ["TEAM_KPI", "DELETED", {}],
  ["DAYS_OFF", "ENTRY_RECORDED", { requestId: "1", type: "PAID", poolTypeId: "2", poolName: "Vacation", startDate: "2026-08-03", endDate: "2026-08-07", days: "5.0", onBehalf: "false" }],
  ["DAYS_OFF", "ENTRY_RECORDED", { requestId: "1", type: "UNPAID", startDate: "2026-08-03", endDate: "2026-08-03", days: "1.0", onBehalf: "true" }],
  ["DAYS_OFF", "ENTRY_DELETED", { requestId: "1", type: "PAID", poolTypeId: "2", poolName: "Vacation", startDate: "2026-08-03", endDate: "2026-08-07", days: "5.0", onBehalf: "false" }],
  ["DAYS_OFF", "CORRECTION_CREATED", { correctionId: "1", year: "2026", poolTypeId: "2", poolName: "Vacation", operation: "ADD", days: "2.0" }],
  ["DAYS_OFF", "CORRECTION_CREATED", { correctionId: "1", year: "2026", poolTypeId: "2", poolName: "Vacation", operation: "SUBTRACT", days: "1.5" }],
  ["DAYS_OFF", "CORRECTION_UPDATED", { correctionId: "1", poolTypeId: "2", poolName: "Vacation", yearFrom: "2026", yearTo: "2026", operationFrom: "ADD", operationTo: "SUBTRACT", daysFrom: "2.0", daysTo: "3.0" }],
  ["DAYS_OFF", "CORRECTION_DELETED", { correctionId: "1", year: "2026", poolTypeId: "2", poolName: "Vacation", operation: "ADD", days: "2.0" }],
  ["DAYS_OFF", "ALLOWANCE_CHANGED", { poolTypeId: "2", poolName: "Vacation", to: "26.0" }],
  ["DAYS_OFF", "ALLOWANCE_CHANGED", { poolTypeId: "2", poolName: "Vacation", from: "20.0", to: "26.0" }],
  ["DAYS_OFF", "POOL_ARCHIVED", { poolId: "9", poolTypeId: "2", poolName: "Vacation", allowance: "5.0" }],
  ["CAREER_POSITION", "POSITION_CREATED", { positionId: "1", startDate: "2026-01-01", careerPath: "3", careerPathName: "Engineering", seniorityLevel: "5", seniorityLevelName: "Senior" }],
  ["CAREER_POSITION", "POSITION_CREATED", { positionId: "1", startDate: "2026-01-01" }],
  ["CAREER_POSITION", "POSITION_UPDATED", { positionId: "1", startDate: "2026-02-01", startDateFrom: "2026-01-01", startDateTo: "2026-02-01", seniorityLevelFrom: "5", seniorityLevelFromName: "Senior", seniorityLevelTo: "6", seniorityLevelToName: "Lead" }],
  ["CAREER_POSITION", "POSITION_DELETED", { positionId: "1", startDate: "2026-01-01", careerSpecialization: "4", careerSpecializationName: "Backend" }],
  ["ACCOUNT", "SIGNED_IN", { mfa: "false" }],
  ["ACCOUNT", "SIGNED_IN", { mfa: "true" }],
  ["ACCOUNT", "SIGNED_OUT", {}],
  ["TEAM_MEMBERSHIP", "TEAM_CREATED", { team: "Platform", managerId: "4", manager: "Ann Lee", memberCount: "3" }],
  ["TEAM_MEMBERSHIP", "TEAM_CREATED", { team: "Platform", memberCount: "0" }],
  ["TEAM_MEMBERSHIP", "TEAM_UPDATED", { team: "Core", nameFrom: "Platform", nameTo: "Core" }],
  ["TEAM_MEMBERSHIP", "TEAM_UPDATED", { team: "Core", nameFrom: "Platform", nameTo: "Core", managerFrom: "4", managerFromName: "Ann Lee", managerTo: "5", managerToName: "Bob Roe", membersAdded: "7,8", membersAddedNames: "Jane Doe, Joe Poe", membersRemoved: "9", membersRemovedNames: "Kim Moe" }],
  ["TEAM_MEMBERSHIP", "TEAM_UPDATED", { team: "Core", managerTo: "5", membersAdded: "7,8", membersRemoved: "9" }],
  ["TEAM_MEMBERSHIP", "TEAM_UPDATED", { team: "Core" }],
  ["TEAM_MEMBERSHIP", "TEAM_DELETED", { team: "Core", membershipsEnded: "2", futureRowsRemoved: "0" }],
  ["TEAM_MEMBERSHIP", "MEMBER_ADDED", { team: "Platform", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05" }],
  ["TEAM_MEMBERSHIP", "MEMBER_ADDED", { team: "Platform", memberUserId: "7" }],
  ["TEAM_MEMBERSHIP", "MEMBER_REMOVED", { team: "Platform", memberUserId: "7", member: "Jane Doe", endDate: "2026-10-13" }],
  ["TEAM_MEMBERSHIP", "MEMBER_REMOVED", { team: "Platform", memberUserId: "7", member: "Jane Doe", hardDeleted: "true" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_CREATED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05", endDate: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_CREATED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_CREATED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe", endDate: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_CREATED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_UPDATED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-06", startDateFrom: "2026-01-05", startDateTo: "2026-01-06", endDateTo: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_UPDATED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe", endDateFrom: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_UPDATED", { team: "Platform", memberUserId: "7" }],
  ["TEAM_MEMBERSHIP", "MEMBERSHIP_DELETED", { team: "Platform", membershipId: "1", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05", endDate: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MANAGER_PERIOD_CREATED", { team: "Platform", periodId: "3", managerId: "4", manager: "Ann Lee", startDate: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MANAGER_PERIOD_CREATED", { team: "Platform", periodId: "3", managerId: "4", manager: "Ann Lee" }],
  ["TEAM_MEMBERSHIP", "MANAGER_PERIOD_UPDATED", { team: "Platform", periodId: "3", managerId: "5", manager: "Bob Roe", startDate: "2026-03-02", managerFrom: "4", managerFromName: "Ann Lee", managerTo: "5", managerToName: "Bob Roe", startDateFrom: "2026-03-01", startDateTo: "2026-03-02" }],
  ["TEAM_MEMBERSHIP", "MANAGER_PERIOD_UPDATED", { team: "Platform", periodId: "3", managerId: "4", manager: "Ann Lee", startDateTo: "2026-03-02" }],
  ["TEAM_MEMBERSHIP", "MANAGER_PERIOD_UPDATED", { team: "Platform", periodId: "3", managerId: "4", manager: "Ann Lee", startDate: "2026-03-01" }],
  ["TEAM_MEMBERSHIP", "MANAGER_PERIOD_DELETED", { team: "Platform", periodId: "3", managerId: "4", manager: "Ann Lee", startDate: "2026-03-01", endDate: "2026-06-30", absorbedByPeriodId: "2" }],
];

const SHARE_AREAS = [
  "FEEDBACK",
  "ONE_ON_ONE",
  "GOAL",
  "PERFORMANCE_REVIEW",
  "TEAM_KPI",
  "IMPACT_LOG_ENTRY",
  "SUCCESSION_PLAN",
] as const;

for (const area of SHARE_AREAS) {
  CASES.push([area, "SHARE_CREATED", { sharee: "Ben Bystander" }]);
  CASES.push([area, "SHARE_CREATED", { sharee: "Ben Bystander", expiresOn: "2026-12-31" }]);
  CASES.push([area, "SHARE_WITHDRAWN", { sharee: "Ben Bystander" }]);
  CASES.push([area, "SHARE_WITHDRAWN", { sharee: "Ben Bystander", byAuthor: "true", sharer: "Sue Sharer" }]);
}

// The share-only pulse area (v4.12.0): generic noun when the snapshot is missing.
CASES.push(["PULSE_TEAM_RESULTS", "SHARE_CREATED", { sharee: "Ben Bystander" }]);
CASES.push(["PULSE_TEAM_RESULTS", "SHARE_CREATED", { sharee: "Ben Bystander", expiresOn: "2026-12-31" }]);
CASES.push(["PULSE_TEAM_RESULTS", "SHARE_WITHDRAWN", { sharee: "Ben Bystander" }]);
CASES.push(["PULSE_TEAM_RESULTS", "SHARE_WITHDRAWN", { sharee: "Ben Bystander", byAuthor: "true", sharer: "Sue Sharer" }]);

// The days-off area also carries calendar SHARE rows (v4.11.0) — a different row kind from its
// person-scoped event rows, worded with the generic noun when the snapshot is missing.
CASES.push(["DAYS_OFF", "SHARE_CREATED", { sharee: "Ben Bystander" }]);
CASES.push(["DAYS_OFF", "SHARE_CREATED", { sharee: "Ben Bystander", expiresOn: "2026-12-31" }]);
CASES.push(["DAYS_OFF", "SHARE_WITHDRAWN", { sharee: "Ben Bystander" }]);
CASES.push(["DAYS_OFF", "SHARE_WITHDRAWN", { sharee: "Ben Bystander", byAuthor: "true", sharer: "Sue Sharer" }]);

describe("describeActivity", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  test.each(["en", "pl"] as const)(
    "every area x eventType renders a real %s sentence (never a raw key, type name or placeholder)",
    (lang) => {
      for (const [area, eventType, params] of CASES) {
        const text = describeActivity(entry(area, eventType, params), ctxFor(lang));
        const label = `${area}/${eventType}/${JSON.stringify(params)} -> ${text}`;
        expect(text.trim(), label).not.toBe("");
        expect(text, label).not.toBe(eventType);
        expect(text, label).not.toMatch(/activity\.|\.event\.|undefined|NaN|\{\{/);
        // A raw wire enum name leaking into the sentence is a missing label.
        expect(text, label).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b/);
      }
    },
  );

  test("team-structure rows are worded from the frozen snapshots, dates formatted per locale", () => {
    const en = ctxFor("en");
    const t = (type: string, params: Record<string, string>, extra: Partial<ActivityEntry> = {}) =>
      describeActivity(entry("TEAM_MEMBERSHIP", type, params, extra), en);
    expect(t("TEAM_CREATED", { team: "Platform", managerId: "4", manager: "Ann Lee" })).toBe("Created team Platform, managed by Ann Lee");
    expect(t("TEAM_CREATED", { team: "Platform" })).toBe("Created team Platform");
    expect(t("TEAM_UPDATED", { team: "Core", nameFrom: "Platform", nameTo: "Core" })).toBe("Renamed team Platform → Core");
    expect(
      t("TEAM_UPDATED", { team: "Core", nameFrom: "Platform", nameTo: "Core", managerTo: "5", managerToName: "Bob Roe", membersAdded: "7,8", membersAddedNames: "Jane Doe, Joe Poe", membersRemoved: "9" }),
    ).toBe("Changed team Core: Renamed team Platform → Core; manager not set → Bob Roe; added Jane Doe, Joe Poe; removed #9");
    expect(t("TEAM_UPDATED", { team: "Core" })).toBe("Changed team Core");
    expect(t("TEAM_DELETED", { team: "Core" })).toBe("Deleted team Core");
    expect(t("MEMBER_ADDED", { team: "Platform", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05" })).toBe(
      "Added Jane Doe to Platform from Jan 5, 2026",
    );
    expect(t("MEMBER_ADDED", { team: "Platform", memberUserId: "7", member: "Jane Doe" })).toBe("Added Jane Doe to Platform");
    expect(t("MEMBER_REMOVED", { team: "Platform", memberUserId: "7", member: "Jane Doe", endDate: "2026-10-13" })).toBe(
      "Removed Jane Doe from Platform (last day Oct 13, 2026)",
    );
    expect(t("MEMBER_REMOVED", { team: "Platform", memberUserId: "7", member: "Jane Doe", hardDeleted: "true" })).toBe(
      "Removed Jane Doe from Platform",
    );
    expect(t("MEMBERSHIP_CREATED", { team: "Platform", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05" })).toBe(
      "Added a membership period of Jane Doe in Platform: from Jan 5, 2026",
    );
    expect(t("MEMBERSHIP_CREATED", { team: "Platform", memberUserId: "7", member: "Jane Doe", endDate: "2026-03-01" })).toBe(
      "Added a membership period of Jane Doe in Platform: from before records began until Mar 1, 2026",
    );
    expect(t("MEMBERSHIP_CREATED", { team: "Platform", memberUserId: "7", member: "Jane Doe" })).toBe(
      "Added a membership period of Jane Doe in Platform: from before records began",
    );
    expect(
      t("MEMBERSHIP_UPDATED", { team: "Platform", memberUserId: "7", member: "Jane Doe", startDateFrom: "2026-01-05", endDateTo: "2026-03-01" }),
    ).toBe("Changed the membership period of Jane Doe in Platform: start Jan 5, 2026 → before records began; end open-ended → Mar 1, 2026");
    expect(t("MEMBERSHIP_DELETED", { team: "Platform", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05", endDate: "2026-03-01" })).toBe(
      "Deleted a membership period of Jane Doe in Platform: Jan 5, 2026 – Mar 1, 2026",
    );
    expect(t("MANAGER_PERIOD_CREATED", { team: "Platform", managerId: "4", manager: "Ann Lee", startDate: "2026-03-01" })).toBe(
      "Added a manager period of Platform: Ann Lee manages from Mar 1, 2026",
    );
    expect(
      t("MANAGER_PERIOD_UPDATED", { team: "Platform", managerId: "5", manager: "Bob Roe", managerFrom: "4", managerFromName: "Ann Lee", managerTo: "5", managerToName: "Bob Roe", startDateFrom: "2026-03-01", startDateTo: "2026-03-02" }),
    ).toBe("Changed a manager period of Platform: manager Ann Lee → Bob Roe; start Mar 1, 2026 → Mar 2, 2026");
    expect(t("MANAGER_PERIOD_UPDATED", { team: "Platform", managerId: "5", manager: "Bob Roe", startDate: "2026-03-02" })).toBe(
      "Changed a manager period of Platform: Bob Roe manages from Mar 2, 2026",
    );
    expect(t("MANAGER_PERIOD_DELETED", { team: "Platform", managerId: "4", manager: "Ann Lee", startDate: "2026-03-01" })).toBe(
      "Deleted a manager period of Platform: Ann Lee, from Mar 1, 2026",
    );
    // Missing snapshots fall back to the ids, then to a bare placeholder — never "undefined".
    expect(t("MEMBER_ADDED", { memberUserId: "7" }, { documentId: 12 })).toBe("Added #7 to #12");
    expect(t("MEMBER_ADDED", {})).toBe("Added ? to ?");
    expect(t("SOMETHING_NEW", {})).toBe("SOMETHING_NEW");
  });

  test("team-structure rows read in Polish with the inclusive voice", () => {
    const pl = ctxFor("pl");
    const t = (type: string, params: Record<string, string>) => describeActivity(entry("TEAM_MEMBERSHIP", type, params), pl);
    expect(t("MEMBER_ADDED", { team: "Platform", memberUserId: "7", member: "Jane Doe", startDate: "2026-01-05" })).toMatch(
      /^Dodał\/a osobę Jane Doe do zespołu Platform od /,
    );
    expect(t("MEMBER_REMOVED", { team: "Platform", memberUserId: "7", member: "Jane Doe", endDate: "2026-10-13" })).toMatch(
      /^Usunął\/usunęła osobę Jane Doe z zespołu Platform \(ostatni dzień: /,
    );
    expect(t("TEAM_UPDATED", { team: "Core", nameFrom: "Platform", nameTo: "Core" })).toBe("Zmienił/a nazwę zespołu Platform → Core");
    expect(t("MANAGER_PERIOD_CREATED", { team: "Platform", managerId: "4", manager: "Ann Lee" })).toBe(
      "Dodał/a okres kierowania zespołem Platform: Ann Lee kieruje od przed początkiem zapisów",
    );
  });

  test("an event kind this build does not know renders its raw type (forward-compat)", () => {
    expect(describeActivity(entry("GOAL", "SOMETHING_NEW"), ctxFor("en"))).toBe("SOMETHING_NEW");
    expect(describeActivity(entry("DAYS_OFF", "SOMETHING_NEW"), ctxFor("en"))).toBe("SOMETHING_NEW");
    expect(describeActivity(entry("ACCOUNT", "SOMETHING_NEW"), ctxFor("pl"))).toBe("SOMETHING_NEW");
  });

  test("document rows dispatch to the per-area describers, with the row's params", () => {
    const en = ctxFor("en");
    expect(describeActivity(entry("GOAL", "PROGRESS_UPDATED", { from: "10.0", to: "20.0" }), en)).toBe(
      "Progress updated from 10 to 20.",
    );
    expect(describeActivity(entry("FEEDBACK", "STATUS_CHANGED", { from: "DRAFT", to: "SENT" }), en)).toContain("Sent");
    // 1:1 item owners are named from the row's label facts.
    expect(
      describeActivity(
        entry("ONE_ON_ONE", "ACTION_ITEM_OWNER_CHANGED", { position: "2", from: "MANAGER", to: "SUBORDINATE" }, { details: { manager: "Mia Manager", subordinate: "Sam Sub", meetingDate: "2026-07-01" } }),
        en,
      ),
    ).toMatch(/Mia Manager.*Sam Sub/);
  });

  test("team KPI values format with the KPI type taken from the row's details, then its params", () => {
    const params = { value: "40.0", date: "2026-07-10" };
    const pct = describeActivity(entry("TEAM_KPI", "VALUE_RECORDED", params, { details: { title: "T", team: "A", type: "PERCENTAGE" } }), ctxFor("en"));
    const num = describeActivity(entry("TEAM_KPI", "VALUE_RECORDED", params, { details: { title: "T", team: "A" } }), ctxFor("en"));
    expect(pct).toContain("40%");
    expect(num).not.toContain("%");
    expect(describeActivity(entry("TEAM_KPI", "VALUE_RECORDED", { ...params, type: "PERCENTAGE" }), ctxFor("en"))).toContain("40%");
  });

  test("share sentences name the kind, the sharee, the end date and an author's withdrawal", () => {
    const en = ctxFor("en");
    const pl = ctxFor("pl");
    expect(describeActivity(entry("GOAL", "SHARE_CREATED", { sharee: "Ben" }), en)).toBe("Shared a goal with Ben");
    expect(describeActivity(entry("GOAL", "SHARE_CREATED", { sharee: "Ben", expiresOn: "2026-12-31" }), en)).toBe(
      "Shared a goal with Ben until Dec 31, 2026",
    );
    expect(describeActivity(entry("FEEDBACK", "SHARE_WITHDRAWN", { sharee: "Ben" }), en)).toBe(
      "Withdrew the share of feedback with Ben",
    );
    expect(
      describeActivity(entry("SUCCESSION_PLAN", "SHARE_WITHDRAWN", { sharee: "Ben", byAuthor: "true", sharer: "Sue" }), en),
    ).toBe("Withdrew Sue's share of a succession plan with Ben");
    // Polish: inclusive slash form, per-noun case (accusative on create, genitive on withdrawal).
    expect(describeActivity(entry("GOAL", "SHARE_CREATED", { sharee: "Ben" }), pl)).toBe("Udostępnił/a cel osobie Ben");
    expect(describeActivity(entry("PERFORMANCE_REVIEW", "SHARE_CREATED", { sharee: "Ben", expiresOn: "2026-12-31" }), pl)).toMatch(
      /^Udostępnił\/a ocenę okresową osobie Ben do /,
    );
    expect(describeActivity(entry("PERFORMANCE_REVIEW", "SHARE_WITHDRAWN", { sharee: "Ben" }), pl)).toBe(
      "Wycofał/a udostępnienie oceny okresowej osobie Ben",
    );
  });

  test("a days-off calendar share names the person from the stored snapshot, falling back to the generic noun (v4.11.0)", () => {
    const en = ctxFor("en");
    const pl = ctxFor("pl");
    const details = { person: "Pat Person" };
    expect(describeActivity(entry("DAYS_OFF", "SHARE_CREATED", { sharee: "Ben" }, { details }), en)).toBe(
      "Shared Pat Person's days-off calendar with Ben",
    );
    expect(
      describeActivity(entry("DAYS_OFF", "SHARE_CREATED", { sharee: "Ben", expiresOn: "2026-12-31" }, { details }), en),
    ).toBe("Shared Pat Person's days-off calendar with Ben until Dec 31, 2026");
    expect(describeActivity(entry("DAYS_OFF", "SHARE_WITHDRAWN", { sharee: "Ben" }, { details }), en)).toBe(
      "Withdrew the share of Pat Person's days-off calendar with Ben",
    );
    expect(
      describeActivity(
        entry("DAYS_OFF", "SHARE_WITHDRAWN", { sharee: "Ben", byAuthor: "true", sharer: "Sue" }, { details }),
        en,
      ),
    ).toBe("Withdrew Sue's share of Pat Person's days-off calendar with Ben");
    // No snapshot: the generic noun, never a half-filled "{{person}}".
    expect(describeActivity(entry("DAYS_OFF", "SHARE_CREATED", { sharee: "Ben" }), en)).toBe(
      "Shared a days-off calendar with Ben",
    );
    // Polish: accusative on create, genitive on withdrawal.
    expect(describeActivity(entry("DAYS_OFF", "SHARE_CREATED", { sharee: "Ben" }, { details }), pl)).toBe(
      "Udostępnił/a kalendarz dni wolnych osoby Pat Person osobie Ben",
    );
    expect(describeActivity(entry("DAYS_OFF", "SHARE_WITHDRAWN", { sharee: "Ben" }, { details }), pl)).toBe(
      "Wycofał/a udostępnienie kalendarza dni wolnych osoby Pat Person osobie Ben",
    );
  });

  test("a pulse results share names the team from the stored snapshot, falling back to the generic noun (v4.12.0)", () => {
    const en = ctxFor("en");
    const pl = ctxFor("pl");
    const details = { team: "AAA" };
    const made = (type: string, params: Record<string, string>, withDetails = true) =>
      entry("PULSE_TEAM_RESULTS", type, params, withDetails ? { details } : undefined);
    expect(describeActivity(made("SHARE_CREATED", { sharee: "Ben" }), en)).toBe(
      "Shared the pulse survey results of AAA with Ben",
    );
    expect(describeActivity(made("SHARE_CREATED", { sharee: "Ben", expiresOn: "2026-12-31" }), en)).toBe(
      "Shared the pulse survey results of AAA with Ben until Dec 31, 2026",
    );
    expect(describeActivity(made("SHARE_WITHDRAWN", { sharee: "Ben" }), en)).toBe(
      "Withdrew the share of the pulse survey results of AAA with Ben",
    );
    expect(describeActivity(made("SHARE_WITHDRAWN", { sharee: "Ben", byAuthor: "true", sharer: "Sue" }), en)).toBe(
      "Withdrew Sue's share of the pulse survey results of AAA with Ben",
    );
    // No snapshot: the generic noun, never a half-filled "{{team}}".
    expect(describeActivity(made("SHARE_CREATED", { sharee: "Ben" }, false), en)).toBe(
      "Shared pulse survey results with Ben",
    );
    // Polish: accusative on create, genitive on withdrawal.
    expect(describeActivity(made("SHARE_CREATED", { sharee: "Ben" }), pl)).toBe(
      "Udostępnił/a wyniki ankiety pulsu zespołu AAA osobie Ben",
    );
    expect(describeActivity(made("SHARE_WITHDRAWN", { sharee: "Ben" }), pl)).toBe(
      "Wycofał/a udostępnienie wyników ankiety pulsu zespołu AAA osobie Ben",
    );
    expect(describeActivity(made("SHARE_WITHDRAWN", { sharee: "Ben", byAuthor: "true", sharer: "Sue" }), pl)).toBe(
      "Wycofał/a udostępnienie wyników ankiety pulsu zespołu AAA osobie Ben, które utworzył/a Sue",
    );
  });

  test("activityDocumentKind: the seven document areas, plus a days-off SHARE row — never the area's event rows", () => {
    expect(activityDocumentKind(entry("GOAL", "PROGRESS_UPDATED"))).toBe("GOAL");
    expect(activityDocumentKind(entry("DAYS_OFF", "SHARE_CREATED"))).toBe("DAYS_OFF_CALENDAR");
    expect(activityDocumentKind(entry("DAYS_OFF", "SHARE_WITHDRAWN"))).toBe("DAYS_OFF_CALENDAR");
    expect(activityDocumentKind(entry("DAYS_OFF", "ENTRY_RECORDED"))).toBeNull();
    expect(activityDocumentKind(entry("CAREER_POSITION", "POSITION_CREATED"))).toBeNull();
    expect(activityDocumentKind(entry("ACCOUNT", "SIGNED_IN"))).toBeNull();
  });

  test("days-off sentences carry the frozen pool name, dates and signed corrections", () => {
    const en = ctxFor("en");
    expect(
      describeActivity(
        entry("DAYS_OFF", "ENTRY_RECORDED", { type: "PAID", poolName: "Vacation", startDate: "2026-08-03", endDate: "2026-08-07", days: "5.0", onBehalf: "true" }),
        en,
      ),
    ).toBe('Recorded days off Aug 3, 2026 – Aug 7, 2026 (5 days, paid, "Vacation" pool)');
    expect(
      describeActivity(entry("DAYS_OFF", "ENTRY_DELETED", { type: "UNPAID", startDate: "2026-08-03", endDate: "2026-08-03", days: "1.0" }), en),
    ).toBe("Deleted days off Aug 3, 2026 – Aug 3, 2026 (1 day, unpaid)");
    expect(
      describeActivity(entry("DAYS_OFF", "CORRECTION_CREATED", { year: "2026", poolName: "Vacation", operation: "SUBTRACT", days: "1.5" }), en),
    ).toBe('Subtracted 1.5 days from the "Vacation" pool for 2026');
    expect(
      describeActivity(
        entry("DAYS_OFF", "CORRECTION_UPDATED", { poolName: "Vacation", yearFrom: "2026", yearTo: "2026", operationFrom: "ADD", operationTo: "SUBTRACT", daysFrom: "2.0", daysTo: "3.0" }),
        en,
      ),
    ).toBe('Changed a correction of the "Vacation" pool: +2 days, 2026 → −3 days, 2026');
    expect(describeActivity(entry("DAYS_OFF", "ALLOWANCE_CHANGED", { poolName: "Vacation", from: "20.0", to: "26.0" }), en)).toBe(
      'Changed the yearly allowance of the "Vacation" pool from 20 to 26 days',
    );
    expect(describeActivity(entry("DAYS_OFF", "ALLOWANCE_CHANGED", { poolName: "Vacation", to: "26.0" }), en)).toBe(
      'Set the yearly allowance of the "Vacation" pool to 26 days',
    );
    expect(describeActivity(entry("DAYS_OFF", "POOL_ARCHIVED", { poolName: "Vacation", allowance: "5.0" }), en)).toBe(
      'Archived the "Vacation" pool (5 days a year)',
    );
    expect(describeActivity(entry("DAYS_OFF", "POOL_ARCHIVED", { poolName: "Urlop", allowance: "5.0" }), ctxFor("pl"))).toBe(
      "Zarchiwizował/a pulę „Urlop” (5 dni rocznie)",
    );
  });

  test("day counts follow the language's plural rules, fractions included", () => {
    const en = ctxFor("en");
    const pl = ctxFor("pl");
    const allowance = (to: string, ctx: ActivityContext) =>
      describeActivity(entry("DAYS_OFF", "ALLOWANCE_CHANGED", { poolName: "Vacation", to }), ctx);
    expect(allowance("1.0", en)).toBe('Set the yearly allowance of the "Vacation" pool to 1 day');
    expect(allowance("1.5", en)).toBe('Set the yearly allowance of the "Vacation" pool to 1.5 days');
    expect(allowance("0.0", en)).toContain("to 0 days");
    expect(allowance("1.0", pl)).toBe("Ustawił/a roczny limit puli „Vacation” na 1 dzień");
    expect(allowance("2.0", pl)).toBe("Ustawił/a roczny limit puli „Vacation” na 2 dni");
    expect(allowance("5.0", pl)).toBe("Ustawił/a roczny limit puli „Vacation” na 5 dni");
    expect(allowance("1.5", pl)).toBe("Ustawił/a roczny limit puli „Vacation” na 1,5 dnia");
  });

  test("a missing frozen pool name reads naturally, with no quoted placeholder", () => {
    const base = { year: "2026", operation: "ADD", days: "2.0", allowance: "5.0", startDate: "2026-08-03", endDate: "2026-08-03" };
    expect(describeActivity(entry("DAYS_OFF", "CORRECTION_CREATED", base), ctxFor("en"))).toBe("Added 2 days to a pool for 2026");
    expect(describeActivity(entry("DAYS_OFF", "POOL_ARCHIVED", base), ctxFor("en"))).toBe("Archived a pool (5 days a year)");
    expect(describeActivity(entry("DAYS_OFF", "ENTRY_RECORDED", { ...base, type: "PAID", days: "1.0" }), ctxFor("en"))).toBe(
      "Recorded days off Aug 3, 2026 – Aug 3, 2026 (1 day, paid)",
    );
    expect(describeActivity(entry("DAYS_OFF", "CORRECTION_CREATED", base), ctxFor("pl"))).toBe("Dodał/a 2 dni do pewnej puli na rok 2026");
    expect(describeActivity(entry("DAYS_OFF", "POOL_ARCHIVED", base), ctxFor("pl"))).toBe("Zarchiwizował/a pewną pulę (5 dni rocznie)");
  });

  test("1:1 item owners without label facts read as neutral role words, never the enum", () => {
    const params = { position: "2", from: "MANAGER", to: "SUBORDINATE" };
    const en = describeActivity(entry("ONE_ON_ONE", "ACTION_ITEM_OWNER_CHANGED", params), ctxFor("en"));
    expect(en).toMatch(/the manager/);
    expect(en).toMatch(/the report/);
    expect(en).not.toMatch(/MANAGER|SUBORDINATE/);
    const pl = describeActivity(entry("ONE_ON_ONE", "ACTION_ITEM_OWNER_CHANGED", params), ctxFor("pl"));
    expect(pl).toMatch(/menedżer\/ka/);
    expect(pl).toMatch(/podwładny\/a/);
  });

  test("an unknown KPI value type renders the bare value — no unit is guessed", () => {
    const bare = describeActivity(entry("TEAM_KPI", "VALUE_RECORDED", { value: "12.0", date: "2026-07-10" }), ctxFor("en"));
    expect(bare).toContain("12");
    expect(bare).not.toContain("%");
    const target = describeActivity(entry("TEAM_KPI", "TARGET_CHANGED", { from: "40.0", to: "50.0" }), ctxFor("en"));
    expect(target).not.toContain("%");
  });

  test("an area this build does not know renders the raw event type", () => {
    const unknown = entry("WIDGET" as ActivityArea, "FROBNICATED");
    expect(describeActivity(unknown, ctxFor("en"))).toBe("FROBNICATED");
  });

  test("career sentences prefer the live dictionary label and fall back to the frozen name", () => {
    const live = (kind: string, id: string) => (kind === "seniorityLevel" && id === "5" ? "Starszy (live)" : undefined);
    const ctx = ctxFor("en", live);
    const created = {
      positionId: "1",
      startDate: "2026-01-01",
      careerPath: "3",
      careerPathName: "Engineering",
      seniorityLevel: "5",
      seniorityLevelName: "Senior",
    };
    // Live label for the level, frozen name for the path (its entry is gone).
    expect(describeActivity(entry("CAREER_POSITION", "POSITION_CREATED", created), ctx)).toBe(
      "Recorded a career position starting Jan 1, 2026 (Engineering · Starszy (live))",
    );
    expect(describeActivity(entry("CAREER_POSITION", "POSITION_CREATED", created), ctxFor("en"))).toBe(
      "Recorded a career position starting Jan 1, 2026 (Engineering · Senior)",
    );
    expect(describeActivity(entry("CAREER_POSITION", "POSITION_DELETED", { positionId: "1", startDate: "2026-01-01" }), ctx)).toBe(
      "Deleted a career position starting Jan 1, 2026",
    );
    expect(
      describeActivity(
        entry("CAREER_POSITION", "POSITION_UPDATED", {
          positionId: "1",
          startDate: "2026-02-01",
          startDateFrom: "2026-01-01",
          startDateTo: "2026-02-01",
          seniorityLevelTo: "6",
          seniorityLevelToName: "Lead",
        }),
        ctxFor("en"),
      ),
    ).toBe(
      "Corrected a career position (start Feb 1, 2026): start date Jan 1, 2026 → Feb 1, 2026; Seniority level: not set → Lead",
    );
    // Polish: inclusive slash forms.
    expect(
      describeActivity(entry("CAREER_POSITION", "POSITION_CREATED", { positionId: "1", startDate: "2026-01-01" }), ctxFor("pl")),
    ).toMatch(/^Zapisał\/a stanowisko w historii kariery od /);
  });

  test("account sentences are subject-free in both languages", () => {
    expect(describeActivity(entry("ACCOUNT", "SIGNED_IN", { mfa: "false" }), ctxFor("en"))).toBe("Signed in");
    expect(describeActivity(entry("ACCOUNT", "SIGNED_IN", { mfa: "true" }), ctxFor("en"))).toBe("Signed in (with a sign-in code)");
    expect(describeActivity(entry("ACCOUNT", "SIGNED_OUT"), ctxFor("en"))).toBe("Signed out");
    expect(describeActivity(entry("ACCOUNT", "SIGNED_IN", { mfa: "false" }), ctxFor("pl"))).toBe("Zalogował/a się");
    expect(describeActivity(entry("ACCOUNT", "SIGNED_IN", { mfa: "true" }), ctxFor("pl"))).toBe("Zalogował/a się (z kodem logowania)");
    expect(describeActivity(entry("ACCOUNT", "SIGNED_OUT"), ctxFor("pl"))).toBe("Wylogował/a się");
  });

  test("isDocumentArea is true for exactly the seven document kinds", () => {
    for (const area of SHARE_AREAS) expect(isDocumentArea(area)).toBe(true);
    for (const area of ["DAYS_OFF", "CAREER_POSITION", "ACCOUNT"] as const) expect(isDocumentArea(area)).toBe(false);
  });
});
