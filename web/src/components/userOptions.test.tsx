import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { activeOnly, renderUserOption, userOption } from "./userOptions";

describe("userOption", () => {
  test("builds the option's keywords by joining the team names", () => {
    expect(userOption(8, "Sam Subordinate", ["alpha", "beta"])).toEqual({
      value: "8",
      label: "Sam Subordinate",
      teamNames: ["alpha", "beta"],
      keywords: "alpha beta",
    });
  });

  test("a teamless person gets empty teamNames and keywords", () => {
    expect(userOption(9, "Bob Brown", [])).toEqual({
      value: "9",
      label: "Bob Brown",
      teamNames: [],
      keywords: "",
    });
  });
});

describe("activeOnly", () => {
  const POOL = [
    { id: 1, name: "Ann", deactivated: false },
    { id: 2, name: "Bob", deactivated: true },
    { id: 3, name: "Cy" },
    { id: 4, name: "Di", deactivated: true },
  ];

  test("drops deactivated people and keeps everyone else in order", () => {
    expect(activeOnly(POOL).map((u) => u.id)).toEqual([1, 3]);
  });

  test("keeps a deactivated person whose id is already selected", () => {
    expect(activeOnly(POOL, [4]).map((u) => u.id)).toEqual([1, 3, 4]);
    expect(activeOnly(POOL, new Set([2, 4])).map((u) => u.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("renderUserOption", () => {
  test("shows the name and a dimmed team-names subtitle when teams exist", () => {
    renderWithProviders(
      renderUserOption({ option: userOption(1, "Ann", ["Team AAA", "Team BBB"]) }),
    );
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByText("Team AAA · Team BBB")).toBeInTheDocument();
  });

  test("renders just the name for a teamless person — no empty subtitle line", () => {
    renderWithProviders(renderUserOption({ option: userOption(2, "Ben", []) }));
    expect(screen.getByText("Ben")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });
});
