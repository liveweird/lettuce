import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import GoalLifecycle from "./GoalLifecycle";

describe("GoalLifecycle", () => {
  test("renders the diagram with every state label", () => {
    renderWithProviders(<GoalLifecycle />);
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    for (const label of ["Draft", "Active", "Archived"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test("renders with a highlighted current status", () => {
    renderWithProviders(<GoalLifecycle currentStatus="ACTIVE" />);
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  test("keyPrefix=\"teamKpi\" renders the team KPI diagram (v3.20.0)", () => {
    renderWithProviders(<GoalLifecycle keyPrefix="teamKpi" currentStatus="ARCHIVED" />);
    expect(
      screen.getByRole("img", { name: "Diagram of the team KPI lifecycle" }),
    ).toBeInTheDocument();
    for (const label of ["Draft", "Active", "Archived"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The four action captions, including "Archive" (not "Archive goal" — team KPIs reword it).
    for (const action of ["Activate", "Return to draft", "Archive", "Reopen"]) {
      expect(screen.getByText(action)).toBeInTheDocument();
    }
  });
});
