import { describe, expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateFeedback } from "./feedbackQueries";

// The helper must reach the dashboard card grids (the "Last feedback" stats), the history
// timeline, and the duplicate-check probes — not just the feedback lists; each of those was
// a hand-rolled-block staleness gap before the helper existed (the goalQueries precedent).
function trackInvalidations(qc: QueryClient): string[] {
  const keys: string[] = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    keys.push(String(filters?.queryKey?.[0]));
    return original(filters as never);
  }) as typeof qc.invalidateQueries;
  return keys;
}

describe("invalidateFeedback", () => {
  test("covers lists, document, history, duplicate probes, bell, and both card grids", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateFeedback(qc, 5);
    expect(keys).toEqual(
      expect.arrayContaining([
        "feedbacks",
        "feedback",
        "feedbackEvents",
        "feedbackDuplicate",
        "notifications",
        "managers",
        "teamMembers",
      ]),
    );
  });

  test("without an id skips the per-document queries", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateFeedback(qc);
    expect(keys).toEqual(
      expect.arrayContaining([
        "feedbacks",
        "feedbackDuplicate",
        "notifications",
        "managers",
        "teamMembers",
      ]),
    );
    expect(keys).not.toContain("feedback");
    expect(keys).not.toContain("feedbackEvents");
  });
});
