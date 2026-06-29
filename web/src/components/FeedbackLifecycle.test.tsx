import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import FeedbackLifecycle from "./FeedbackLifecycle";

describe("FeedbackLifecycle", () => {
  test("renders the diagram with every state label", () => {
    renderWithProviders(<FeedbackLifecycle />);
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    for (const label of ["Requested", "Draft", "Sent", "Withdrawn", "Rejected"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test("renders with a highlighted current status", () => {
    renderWithProviders(<FeedbackLifecycle currentStatus="SENT" />);
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });
});
