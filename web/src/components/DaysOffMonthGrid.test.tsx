import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import DaysOffMonthGrid from "./DaysOffMonthGrid";
import classes from "./DaysOffMonthGrid.module.css";
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
      sharedBy: null,
      canShareCalendar: false,
      entries: [
        { requestId: 3, date: "2026-01-05", type: "PAID", poolName: "Paid days off", half: true },
        { requestId: 3, date: "2026-01-07", type: "PAID", poolName: "Paid days off", half: false },
        { requestId: 4, date: "2026-01-12", type: "UNPAID", poolName: null, half: false },
      ],
    },
    { userId: 8, userName: "Bob Empty", userDeleted: false, teams: [], sharedBy: null, canShareCalendar: false, entries: [] },
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

  describe("today (v4.7.0)", () => {
    afterEach(() => vi.useRealTimers());
    // Local noon, so the viewer's local date is unambiguous in any test time zone.
    const setToday = (iso: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${iso}T12:00:00`));
    };

    test("marks today's header (aria-current + tooltip) and edges its column, without hiding an entry", () => {
      setToday("2026-01-07");
      renderWithProviders(<DaysOffMonthGrid data={DATA} />);

      const headers = screen.getAllByRole("columnheader");
      const todayHeader = headers[7]; // 0 = the person column
      expect(todayHeader).toHaveAttribute("aria-current", "date");
      expect(todayHeader).toHaveAttribute("title", "Today");
      expect(todayHeader).toHaveClass(classes.todayHeader);
      expect(headers.filter((h) => h.getAttribute("aria-current") === "date")).toHaveLength(1);

      // Every body cell in today's column carries the edge-line class; Alice's full PAID day on
      // the 7th still renders its fill inside it — the marker never replaces the entry.
      const [aliceRow, bobRow] = screen.getAllByRole("row").slice(1);
      const aliceToday = aliceRow.querySelectorAll("td")[6];
      const bobToday = bobRow.querySelectorAll("td")[6];
      expect(aliceToday).toHaveClass(classes.todayColumn);
      expect(bobToday).toHaveClass(classes.todayColumn);
      expect(aliceToday.querySelector(`.${classes.paid}`)).not.toBeNull();
      expect(aliceRow.querySelectorAll(`.${classes.todayColumn}`)).toHaveLength(1);

      expect(screen.getByText("Today")).toBeInTheDocument(); // the legend swatch
    });

    test("today on a public holiday names both in the header tooltip; its body cells keep the holiday tint", () => {
      setToday("2026-01-06");
      renderWithProviders(<DaysOffMonthGrid data={DATA} />);
      const todayHeader = screen.getAllByRole("columnheader")[6];
      // The header shows the today accent (it wins over the holiday tint), so the tooltip is
      // where the holiday stays named.
      expect(todayHeader).toHaveAttribute("title", "Today · Epiphany");
      expect(todayHeader).toHaveClass(classes.todayHeader);
      // The column's body cells carry BOTH: the holiday tint and today's edge lines.
      const bobToday = screen.getAllByRole("row")[2].querySelectorAll("td")[5];
      expect(bobToday).toHaveClass(classes.holidayDay);
      expect(bobToday).toHaveClass(classes.todayColumn);
    });

    test("a month that does not contain today marks nothing and shows no Today legend", () => {
      setToday("2026-02-10");
      renderWithProviders(<DaysOffMonthGrid data={DATA} />);
      expect(screen.getAllByRole("columnheader").some((h) => h.hasAttribute("aria-current"))).toBe(false);
      expect(document.querySelectorAll(`.${classes.todayColumn}`)).toHaveLength(0);
      expect(screen.queryByText("Today")).toBeNull();
    });
  });
});
