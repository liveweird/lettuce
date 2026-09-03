import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import StatusPill from "./StatusPill";

describe("StatusPill", () => {
  test("renders the label with the given accessible name and title", () => {
    renderWithProviders(
      <StatusPill color="teal" ariaLabel="Status" title="Delivered on Monday">
        Sent
      </StatusPill>,
    );
    const pill = screen.getByText("Sent").closest("[aria-label]");
    expect(pill).toHaveAttribute("aria-label", "Status");
    expect(pill).toHaveAttribute("title", "Delivered on Monday");
    expect(pill).toHaveStyle({ minWidth: "max-content" });
  });

  test("the hue dot is decorative and carries the hue's colour variable", () => {
    const { container } = renderWithProviders(
      <StatusPill color="orange" dot>
        Withdrawn
      </StatusPill>,
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    const root = screen.getByText("Withdrawn").closest("[style]") as HTMLElement;
    expect(root.style.getPropertyValue("--pill-dot")).toContain("--mantine-color-orange-6");
  });

  test("without `dot` there is no decorative span, and a custom icon renders instead", () => {
    const { container } = renderWithProviders(
      <StatusPill color="gray" icon={<svg data-testid="probe" />}>
        Default
      </StatusPill>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId("probe")).toBeInTheDocument();
  });

  test("size sm sets the compact badge dimensions", () => {
    renderWithProviders(
      <StatusPill color="gray" size="sm">
        Not set
      </StatusPill>,
    );
    const root = screen.getByText("Not set").closest("[style]") as HTMLElement;
    expect(root.style.getPropertyValue("--badge-height")).toContain("1.125rem");
  });
});
