import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import DaysOffMonthGrid from "./DaysOffMonthGrid";
import type { DaysOffCalendarResponse } from "../api/client";

const DATA: DaysOffCalendarResponse = {
  month: "2026-01",
  holidays: [{ id: 1, date: "2026-01-06", name: "Epiphany" }],
  users: [
    {
      userId: 7,
      userName: "Alice Example",
      userDeleted: false,
      entries: [
        { requestId: 3, date: "2026-01-05", type: "PAID", status: "ACCEPTED", half: true },
        { requestId: 3, date: "2026-01-07", type: "PAID", status: "ACCEPTED", half: false },
        { requestId: 4, date: "2026-01-12", type: "UNPAID", status: "REQUESTED", half: false },
      ],
    },
    { userId: 8, userName: "Bob Empty", userDeleted: false, entries: [] },
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

    // Entry cells carry accessible descriptions (type, status, amount).
    expect(
      screen.getByTitle("Alice Example — 2026-01-05: Paid, Accepted (0.5 day)"),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("Alice Example — 2026-01-12: Unpaid, Requested (1 day)"),
    ).toBeInTheDocument();

    // The legend names all five fills — weekends and holidays are distinct kinds (v1.43.0).
    expect(screen.getByText("Paid day off")).toBeInTheDocument();
    expect(screen.getByText("Unpaid day off")).toBeInTheDocument();
    expect(screen.getByText("Requested (pending)")).toBeInTheDocument();
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
});
