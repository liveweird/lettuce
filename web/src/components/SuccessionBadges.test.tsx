import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import {
  BenchBadge,
  CriticalityBadge,
  PlanStatusBadge,
  RetentionRiskBadge,
} from "./SuccessionBadges";

function renderBadge(node: React.ReactNode) {
  return render(<MantineProvider env="test">{node}</MantineProvider>);
}

describe("SuccessionBadges", () => {
  test("criticality and risk render their labels", () => {
    renderBadge(
      <>
        <CriticalityBadge value="CRITICAL" />
        <RetentionRiskBadge value="LOW" />
        <PlanStatusBadge value="CLOSED" />
      </>,
    );
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  test("an under-target bench warns (orange) with the short aria", () => {
    renderBadge(<BenchBadge count={1} target={2} />);
    const badge = screen.getByText("1 / 2");
    expect(badge.closest(".mantine-Badge-root")?.getAttribute("style")).toContain("orange");
    expect(
      screen.getByLabelText("Bench below target: 1 of 2 successors nominated"),
    ).toBeInTheDocument();
  });

  test("a met bench reads teal with the met aria (equality counts)", () => {
    renderBadge(<BenchBadge count={2} target={2} />);
    const badge = screen.getByText("2 / 2");
    expect(badge.closest(".mantine-Badge-root")?.getAttribute("style")).toContain("teal");
    expect(
      screen.getByLabelText("Bench at target: 2 of 2 successors nominated"),
    ).toBeInTheDocument();
  });
});
