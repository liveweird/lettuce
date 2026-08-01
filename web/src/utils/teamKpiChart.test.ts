import { describe, expect, test } from "vitest";
import type { TeamKpiEvent, TeamKpiResponse } from "../api/client";
import { buildTeamKpiSeries } from "./teamKpiChart";

const KPI: TeamKpiResponse = {
  id: 1,
  teamId: 7,
  teamName: "Team AAA",
  teamDeleted: false,
  managerId: 2,
  managerName: "Mona",
  createdAt: 1000,
  title: "Deploy frequency",
  description: "",
  type: "NUMBER",
  targetValue: 10,
  currentValue: 5,
  currentValueDate: null,
  status: "ACTIVE",
  summary: null,
  lastModified: 5000,
};

function event(partial: Partial<TeamKpiEvent> & Pick<TeamKpiEvent, "type" | "timestamp">): TeamKpiEvent {
  return { id: 1, kpiId: 1, userId: 2, userName: "Mona", params: {}, ...partial };
}

describe("buildTeamKpiSeries", () => {
  test("synthesizes the origin at createdAt and plots each PROGRESS_UPDATED at its recorded date", () => {
    const d1 = Date.parse("2026-07-01");
    const d2 = Date.parse("2026-07-10");
    const events = [
      event({ type: "CREATED", timestamp: 1000, params: { type: "NUMBER" } }),
      event({ type: "STATUS_CHANGED", timestamp: 1500, params: { from: "DRAFT", to: "ACTIVE" } }),
      event({ type: "PROGRESS_UPDATED", timestamp: 2000, params: { to: "2.5", date: "2026-07-01" } }),
      event({ type: "PROGRESS_UPDATED", timestamp: 3000, params: { to: "5.0", date: "2026-07-10" } }),
    ];
    expect(buildTeamKpiSeries(KPI, events)).toEqual([
      { ts: 1000, value: 0 },
      { ts: d1, value: 2.5 },
      { ts: d2, value: 5 },
    ]);
  });

  test("legacy date-less events fall back to the event timestamp", () => {
    const events = [
      event({ type: "PROGRESS_UPDATED", timestamp: 2000, params: { from: "0.0", to: "2.5" } }),
      event({ type: "PROGRESS_UPDATED", timestamp: 3000, params: { from: "2.5", to: "5.0" } }),
    ];
    expect(buildTeamKpiSeries(KPI, events)).toEqual([
      { ts: 1000, value: 0 },
      { ts: 2000, value: 2.5 },
      { ts: 3000, value: 5 },
    ]);
  });

  test("backdated points are sorted into chronological order", () => {
    const events = [
      event({ type: "PROGRESS_UPDATED", timestamp: 2000, params: { to: "50.0", date: "2026-07-20" } }),
      // Backfilled later, dated earlier — must land between the origin and the July-20 point.
      event({ type: "PROGRESS_UPDATED", timestamp: 3000, params: { to: "30.0", date: "2026-07-05" } }),
    ];
    expect(buildTeamKpiSeries(KPI, events)).toEqual([
      { ts: 1000, value: 0 },
      { ts: Date.parse("2026-07-05"), value: 30 },
      { ts: Date.parse("2026-07-20"), value: 50 },
    ]);
  });

  test("the origin is suppressed when a recorded point predates the KPI's creation", () => {
    const kpi = { ...KPI, createdAt: Date.parse("2026-07-10") };
    const events = [
      event({ type: "PROGRESS_UPDATED", timestamp: 2000, params: { to: "30.0", date: "2026-07-01" } }),
      event({ type: "PROGRESS_UPDATED", timestamp: 3000, params: { to: "50.0", date: "2026-07-20" } }),
    ];
    // No dip to 0 at creation between the two recorded values.
    expect(buildTeamKpiSeries(kpi, events)).toEqual([
      { ts: Date.parse("2026-07-01"), value: 30 },
      { ts: Date.parse("2026-07-20"), value: 50 },
    ]);
  });

  test("a TYPE_CHANGED event contributes a zero point (the progress reset is real)", () => {
    const events = [
      event({ type: "PROGRESS_UPDATED", timestamp: 2000, params: { from: "0.0", to: "8.0" } }),
      event({ type: "TYPE_CHANGED", timestamp: 2500, params: { from: "NUMBER", to: "PERCENTAGE" } }),
      event({ type: "PROGRESS_UPDATED", timestamp: 3000, params: { from: "0.0", to: "40.0" } }),
    ];
    expect(buildTeamKpiSeries(KPI, events).map((p) => p.value)).toEqual([0, 8, 0, 40]);
  });

  test("non-numeric progress params are skipped, other events contribute nothing", () => {
    const events = [
      event({ type: "TITLE_CHANGED", timestamp: 1200 }),
      event({ type: "PROGRESS_UPDATED", timestamp: 2000, params: { from: "0.0", to: "garbage" } }),
      event({ type: "DELETED", timestamp: 4000 }),
    ];
    expect(buildTeamKpiSeries(KPI, events)).toEqual([{ ts: 1000, value: 0 }]);
  });
});
