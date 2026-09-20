import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import TeamBadges from "./TeamBadges";

describe("TeamBadges", () => {
  test("renders one linked badge per team, named for its details view", () => {
    renderWithProviders(
      <TeamBadges
        teams={[
          { id: 5, name: "alpha" },
          { id: 9, name: "beta" },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Team details for alpha" })).toHaveAttribute(
      "href",
      "/teams/5/details",
    );
    expect(screen.getByRole("link", { name: "Team details for beta" })).toHaveAttribute(
      "href",
      "/teams/9/details",
    );
  });

  test("renders nothing for an empty list", () => {
    const { container } = renderWithProviders(<TeamBadges teams={[]} />);
    // MantineProvider injects its own <style> tags into the render container in test mode —
    // the component's own output is what we care about, so assert on that rather than the
    // whole container being empty.
    expect(container.querySelector("a, [class*='Badge'], [class*='Group']")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
