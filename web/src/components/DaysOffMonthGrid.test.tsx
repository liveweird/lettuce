import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import DaysOffMonthGrid from "./DaysOffMonthGrid";
import type { DaysOffCalendarResponse } from "../api/daysoff";

const DATA: DaysOffCalendarResponse = {
  month: "2026-01",
  holidays: [{ id: 1, date: "2026-01-06", name: "Epiphany" }],
  users: [
    {
      userId: 7,
      userName: "Alice Example",
      userDeleted: false,
      teams: [{ id: 1, name: "AAA" }],
      entries: [
        { requestId: 3, date: "2026-01-05", type: "PAID", poolName: "Paid days off", half: true },
        { requestId: 3, date: "2026-01-07", type: "PAID", poolName: "Paid days off", half: false },
        { requestId: 4, date: "2026-01-12", type: "UNPAID", poolName: null, half: false },
      ],
    },
    { userId: 8, userName: "Bob Empty", userDeleted: false, teams: [], entries: [] },
  ],
};

describe("DaysOffMonthGrid", () => {
  test("renders one row per user, day columns, entry fills, and the legend", () => {
    renderWithProviders(<DaysOffMonthGrid data={DATA} />);

    const grid = screen.getByRole("table", { name: "Team days-off calendar" });
    expect(grid).toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    // A user without entries still gets a row.
    expect(screen.getByText("Bob Empty")).toBeInTheDocument();

    // 31 January days + the person column.
    expect(screen.getAllByRole("columnheader")).toHaveLength(32);
    // The holiday name rides the column header tooltip (and the empty cells in its column).
    expect(screen.getAllByTitle("Epiphany").length).toBeGreaterThan(0);

    // Entry cells carry accessible descriptions (the pool name for paid days — v3.2.0 —, amount;
    // no status since v3.9.0 — there is no lifecycle to describe).
    expect(
      screen.getByTitle("Alice Example — 2026-01-05: Paid days off (0.5 day)"),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("Alice Example — 2026-01-12: Unpaid (1 day)"),
    ).toBeInTheDocument();

    // The legend names all four fills — weekends and holidays are distinct kinds (v1.43.0);
    // no tentative/"Requested (pending)" swatch since v3.9.0.
    expect(screen.getByText("Paid day off")).toBeInTheDocument();
    expect(screen.getByText("Unpaid day off")).toBeInTheDocument();
    expect(screen.queryByText("Requested (pending)")).toBeNull();
    expect(screen.getByText("Weekend")).toBeInTheDocument();
    expect(screen.getByText("Public holiday")).toBeInTheDocument();
  });

  test("the current user's row reads You", () => {
    localStorage.setItem("lettuce.auth.userId", "7");
    renderWithProviders(<DaysOffMonthGrid data={DATA} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Alice Example")).toBeNull();
    localStorage.clear();
  });

  test("showTeams renders the team line under a managed row but never under You (v3.13.0)", () => {
    localStorage.setItem("lettuce.auth.userId", "7");
    renderWithProviders(<DaysOffMonthGrid data={DATA} showTeams />);
    // Alice (userId 7) is the current user here, so she reads "You" and gets no team line even
    // though she belongs to a team.
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("AAA")).toBeNull();
    localStorage.clear();
  });

  test("showTeams renders another person's team line, not their own without teams", () => {
    renderWithProviders(<DaysOffMonthGrid data={DATA} showTeams />);
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("AAA")).toBeInTheDocument();
    // Bob has no teams — no line renders for him.
    expect(screen.getByText("Bob Empty")).toBeInTheDocument();
  });

  test("without showTeams, no team line renders even though the data carries teams", () => {
    renderWithProviders(<DaysOffMonthGrid data={DATA} />);
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.queryByText("AAA")).toBeNull();
  });
});
