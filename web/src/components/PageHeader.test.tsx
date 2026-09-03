import { describe, expect, test } from "vitest";
import { Button } from "@mantine/core";
import { renderWithProviders, screen } from "../test/render";
import PageHeader from "./PageHeader";

describe("PageHeader", () => {
  test("renders the title as a level-2 heading carrying the tour anchor", () => {
    renderWithProviders(<PageHeader title="Users" tourId="config-users" />);
    const heading = screen.getByRole("heading", { level: 2, name: "Users" });
    expect(heading).toHaveAttribute("data-tour", "config-users");
    expect(heading.closest("header")).not.toBeNull();
  });

  test("renders the back link, badge, actions, and description slots", () => {
    renderWithProviders(
      <PageHeader
        title="Team details"
        back={{ to: "/teams", label: "← Back to Teams" }}
        badge={<span data-testid="probe">Open</span>}
        actions={<Button>New team</Button>}
        description="Everything about one team."
      />,
    );
    expect(screen.getByRole("link", { name: "← Back to Teams" })).toHaveAttribute("href", "/teams");
    expect(screen.getByTestId("probe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New team" })).toBeInTheDocument();
    expect(screen.getByText("Everything about one team.")).toBeInTheDocument();
  });

  test("the sticky variant marks the header element", () => {
    const { container } = renderWithProviders(<PageHeader title="Kudos" sticky />);
    const header = container.querySelector("header");
    expect(header?.className).toMatch(/sticky/);
  });

  test("a falsy actions value renders no action group", () => {
    const { container } = renderWithProviders(<PageHeader title="Teams" actions={false} />);
    // The outer row and the title group only — no third (actions) group.
    expect(container.querySelectorAll("header .mantine-Group-root")).toHaveLength(2);
  });
});
