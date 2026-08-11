import { describe, expect, test } from "vitest";
import { groupTeamRows, type TeamRow } from "./teamRows";

// Fixture teams get stable ids per name — the grouping dedupes by teamId (v2.5.4).
const TEAM_IDS: Record<string, number> = { Platform: 100, Support: 200, Second: 300 };

const row = (overrides: Partial<TeamRow> = {}): TeamRow => {
  const teamName = overrides.teamName ?? "Platform";
  return {
    userId: 1,
    name: "Alice Adams",
    email: "alice@x.test",
    teamId: TEAM_IDS[teamName] ?? 999,
    teamName,
    ...overrides,
  };
};

describe("groupTeamRows", () => {
  test("collapses a user's per-team rows into one card aggregating unique team names", () => {
    const cards = groupTeamRows([
      row({ teamName: "Platform" }),
      row({ teamName: "Support" }),
      row({ teamName: "Support" }), // duplicate badge must not repeat
      row({ userId: 2, name: "Bob Brown", email: "bob@x.test", teamName: "Support" }),
    ]);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ userId: 1, name: "Alice Adams", teamNames: ["Platform", "Support"] });
    expect(cards[1]).toMatchObject({ userId: 2, name: "Bob Brown", teamNames: ["Support"] });
    // The id-carrying twin drives the badge links; teamNames stays derived from it.
    expect(cards[0].teams).toEqual([
      { id: 100, name: "Platform" },
      { id: 200, name: "Support" },
    ]);
    expect(cards[1].teams).toEqual([{ id: 200, name: "Support" }]);
  });

  test("keeps the API's ordering — first appearance wins", () => {
    const cards = groupTeamRows([
      row({ userId: 2, name: "Bob Brown" }),
      row({ userId: 1 }),
      row({ userId: 2, name: "Bob Brown", teamName: "Support" }),
    ]);

    expect(cards.map((c) => c.userId)).toEqual([2, 1]);
  });

  test("normalizes absent stat fields to null (all six)", () => {
    const [card] = groupTeamRows([row()]);

    expect(card.lastOneOnOneDate).toBeNull();
    expect(card.lastOneOnOneOpenItems).toBeNull();
    expect(card.lastFeedbackAt).toBeNull();
    expect(card.lastFeedbackGivenAt).toBeNull();
    expect(card.lastFeedbackReceivedAt).toBeNull();
    expect(card.activeGoalCount).toBeNull();
  });

  test("normalizes absent career fields to null and carries set ones from the first row", () => {
    const [bare] = groupTeamRows([row()]);
    expect(bare.careerPath).toBeNull();
    expect(bare.careerSpecialization).toBeNull();
    expect(bare.seniorityLevel).toBeNull();

    const [card] = groupTeamRows([
      row({ careerPath: { id: 11, valueEn: "Software Engineer", valuePl: "Software Engineer" }, seniorityLevel: { id: 31, valueEn: "Senior", valuePl: "Senior" } }),
      row({ teamName: "Second" }),
    ]);
    expect(card.careerPath).toEqual({ id: 11, valueEn: "Software Engineer", valuePl: "Software Engineer" });
    expect(card.careerSpecialization).toBeNull();
    expect(card.seniorityLevel).toEqual({ id: 31, valueEn: "Senior", valuePl: "Senior" });
  });

  test("carries stats through from the first row of a user (rows repeat identical stats)", () => {
    const stats = {
      lastOneOnOneDate: "2026-07-01",
      lastOneOnOneOpenItems: 0, // zero must survive as 0, not collapse to null
      lastFeedbackAt: 1780000000000,
      lastFeedbackGivenAt: 1780000000001,
      lastFeedbackReceivedAt: 1780000000002,
      activeGoalCount: 0, // zero must survive as 0, not collapse to null
    };
    const [card] = groupTeamRows([
      row({ ...stats }),
      row({ teamName: "Support", ...stats }),
    ]);

    expect(card).toMatchObject(stats);
    expect(card.teamNames).toEqual(["Platform", "Support"]);
  });

  test("returns an empty list for no rows", () => {
    expect(groupTeamRows([])).toEqual([]);
  });
});
