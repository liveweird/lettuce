import { describe, expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateTeamKpi } from "./teamKpiQueries";

function trackInvalidations(qc: QueryClient): string[] {
  const keys: string[] = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    keys.push(String(filters?.queryKey?.[0]));
    return original(filters as never);
  }) as typeof qc.invalidateQueries;
  return keys;
}

describe("invalidateTeamKpi", () => {
  test("covers lists, document, history (the Graph tab's data), and the bell", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateTeamKpi(qc, 5);
    expect(keys).toEqual(
      expect.arrayContaining(["teamKpis", "teamKpi", "teamKpiEvents", "notifications"]),
    );
  });

  test("without an id skips the per-document queries", async () => {
    const qc = new QueryClient();
    const keys = trackInvalidations(qc);
    await invalidateTeamKpi(qc);
    expect(keys).toEqual(expect.arrayContaining(["teamKpis", "notifications"]));
    expect(keys).not.toContain("teamKpi");
    expect(keys).not.toContain("teamKpiEvents");
  });
});
