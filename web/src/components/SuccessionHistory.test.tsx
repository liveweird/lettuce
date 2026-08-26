import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import SuccessionHistory from "./SuccessionHistory";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

let nextId = 1;
function event(type: string, params: Record<string, string> = {}) {
  nextId += 1;
  return {
    id: nextId,
    planId: 5,
    userId: 7,
    userName: "Mona Manager",
    timestamp: new Date(2026, 7, 1, 12, 0).getTime(),
    type,
    params,
  };
}

describe("SuccessionHistory", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders every event kind localized, with the actor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          items: [
            event("CLOSED"),
            event("PRIMARY_DEMOTED", { candidateName: "Cleo Candidate" }),
            event("NOMINATION_UPDATED", {
              candidateName: "Cleo Candidate",
              changed: "readiness,competencyGaps",
              readinessFrom: "READY_SOON",
              readinessTo: "READY_NOW",
            }),
            event("NOMINATION_ADDED", {
              candidateName: "Nina Nominee",
              readiness: "READY_SOON",
              nominationType: "PRIMARY",
            }),
            event("NOMINATION_REMOVED", { candidateName: "Theo Third" }),
            event("REVIEW_COMPLETED"),
            event("CRITICALITY_CHANGED", { from: "CORE", to: "CRITICAL" }),
            event("RISK_CHANGED", { from: "MEDIUM", to: "HIGH" }),
            event("BENCH_DEPTH_CHANGED", { from: "2", to: "3" }),
            event("LOSS_IMPACT_CHANGED"),
            event("CREATED", {
              roleCriticality: "CRITICAL",
              retentionRisk: "HIGH",
              targetBenchDepth: "2",
            }),
          ],
        }),
      ),
    );
    renderWithProviders(<SuccessionHistory planId={5} />);

    expect(await screen.findByText("Plan closed.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The nomination of Cleo Candidate changed to secondary — a new primary was chosen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nomination of Cleo Candidate updated: Readiness window, Competency gaps."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nina Nominee nominated (Ready soon (3–12 mo), Primary)."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nomination of Theo Third removed.")).toBeInTheDocument();
    expect(screen.getByText("Review completed.")).toBeInTheDocument();
    expect(
      screen.getByText("Role criticality changed from Core to Critical."),
    ).toBeInTheDocument();
    expect(screen.getByText("Retention risk changed from Medium to High.")).toBeInTheDocument();
    expect(
      screen.getByText("Target bench depth changed from 2 to 3."),
    ).toBeInTheDocument();
    expect(screen.getByText("Loss-impact list updated.")).toBeInTheDocument();
    expect(
      screen.getByText("Plan created (Critical / High, bench target 2)."),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Mona Manager ·/).length).toBeGreaterThan(0);
  });

  test("an unknown event kind and an unknown field token render raw (forward-compat)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          items: [
            event("FUTURE_KIND"),
            event("NOMINATION_UPDATED", { candidateName: "Cleo Candidate", changed: "mystery" }),
          ],
        }),
      ),
    );
    renderWithProviders(<SuccessionHistory planId={5} />);

    expect(await screen.findByText("FUTURE_KIND")).toBeInTheDocument();
    expect(
      screen.getByText("Nomination of Cleo Candidate updated: mystery."),
    ).toBeInTheDocument();
  });

  test("an empty trail shows the empty-state note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { items: [] })));
    renderWithProviders(<SuccessionHistory planId={5} />);

    expect(await screen.findByText("No history yet.")).toBeInTheDocument();
  });
});
