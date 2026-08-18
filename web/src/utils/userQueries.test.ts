import { describe, expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateUser } from "./userQueries";

// The helper must reach the header account menu and the dashboard card grids (names/emails
// render there), not just the users list — a self-edit leaving the header stale was one of
// the hand-rolled blocks' gaps (the goalQueries precedent).
function trackInvalidations(qc: QueryClient): string[] {
  const keys: string[] = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    keys.push(String(filters?.queryKey?.[0]));
    return original(filters as never);
  }) as typeof qc.invalidateQueries;
  return keys;
}

describe("invalidateUser", () => {
  test("covers lists, document, details view, header identity, and both card grids", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateUser(qc, 7);
    expect(keys).toEqual(
      expect.arrayContaining([
        "users",
        "user",
        "userDetails",
        "currentUser",
        "managers",
        "teamMembers",
      ]),
    );
  });

  test("without an id skips the per-document queries", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateUser(qc);
    expect(keys).toEqual(
      expect.arrayContaining(["users", "currentUser", "managers", "teamMembers"]),
    );
    expect(keys).not.toContain("user");
    expect(keys).not.toContain("userDetails");
  });
});
