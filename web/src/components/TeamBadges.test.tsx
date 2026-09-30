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
      { route: "/?tab=managers" },
    );

    // Each badge returns to the page it sits on (v4.6.0 `back=`).
    expect(screen.getByRole("link", { name: "Team details for alpha" })).toHaveAttribute(
      "href",
      "/teams/5/details?back=%2F%3Ftab%3Dmanagers",
    );
    expect(screen.getByRole("link", { name: "Team details for beta" })).toHaveAttribute(
      "href",
      "/teams/9/details?back=%2F%3Ftab%3Dmanagers",
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
