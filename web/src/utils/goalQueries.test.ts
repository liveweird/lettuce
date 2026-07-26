import { describe, expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateGoal } from "./goalQueries";
import { invalidateOneOnOne } from "./oneOnOneQueries";

// The helpers must reach the dashboard card grids (the "Active goals" / "Last 1:1" stats),
// not just their own feature's queries — that staleness was a checkup finding.
function trackInvalidations(qc: QueryClient): string[] {
  const keys: string[] = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    keys.push(String(filters?.queryKey?.[0]));
    return original(filters as never);
  }) as typeof qc.invalidateQueries;
  return keys;
}

describe("mutation invalidation helpers", () => {
  test("invalidateGoal covers lists, document, history, bell, and both card grids", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateGoal(qc, 5);
    expect(keys).toEqual(
      expect.arrayContaining(["goals", "goal", "goalEvents", "notifications", "managers", "teamMembers"]),
    );
  });

  test("invalidateGoal without an id skips the per-document queries", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateGoal(qc);
    expect(keys).toEqual(
      expect.arrayContaining(["goals", "notifications", "managers", "teamMembers"]),
    );
    expect(keys).not.toContain("goal");
    expect(keys).not.toContain("goalEvents");
  });

  test("invalidateOneOnOne covers lists, document, history, bell, and both card grids", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateOneOnOne(qc, 9);
    expect(keys).toEqual(
      expect.arrayContaining([
        "oneOnOnes",
        "oneOnOne",
        "oneOnOneEvents",
        "notifications",
        "managers",
        "teamMembers",
      ]),
    );
  });
});
