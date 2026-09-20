import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import ReviewLifecycle from "./ReviewLifecycle";

describe("ReviewLifecycle", () => {
  test("renders the diagram with every state label", () => {
    renderWithProviders(<ReviewLifecycle />);
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    for (const label of ["Draft", "Calibration", "Published"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test("renders with a highlighted current status", () => {
    renderWithProviders(<ReviewLifecycle currentStatus="CALIBRATION" />);
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    const highlighted = document.querySelector('rect[fill="var(--mantine-primary-color-light)"]');
    expect(highlighted).not.toBeNull();
  });

  test("with no current status, no node is highlighted", () => {
    renderWithProviders(<ReviewLifecycle />);
    const highlighted = document.querySelector('rect[fill="var(--mantine-primary-color-light)"]');
    expect(highlighted).toBeNull();
  });
});
