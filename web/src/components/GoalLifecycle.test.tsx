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
});
