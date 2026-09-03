import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import DaysOffBudgetsTable from "./DaysOffBudgetsTable";

type FetchMock = ReturnType<typeof vi.fn>;

const YEAR = new Date().getFullYear();
const ROW = {
  userId: 9, userName: "Riley Report", userDeleted: false, year: YEAR,
  poolId: 41, poolTypeId: 1, poolName: "Paid days off", carriesOver: true, isDefault: true, poolArchived: false,
  allowance: 20, carriedOver: 0, corrected: 0, reserved: 0, used: 0, remaining: 20, canCorrect: true,
};
const STUDY = { ...ROW, poolId: 42, poolTypeId: 7, poolName: "Study leave", carriesOver: false, isDefault: false, allowance: 3, remaining: 3 };
const ARCHIVED = { ...STUDY, poolId: null, poolTypeId: 8, poolName: "Old pool", poolArchived: true, allowance: null, remaining: -1 };

describe("DaysOffBudgetsTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse(200, { items: String(url).includes("/budgets") ? [ROW, STUDY, ARCHIVED] : [] }),
      ),
    );
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "5");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("one row per (person, pool) with the Pool column; the Corrections action sits on the default row only (v3.2.0)", async () => {
    renderWithProviders(<DaysOffBudgetsTable />);
    expect(await screen.findByText("Study leave")).toBeInTheDocument();
    expect(screen.getByText("Old pool")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    // Three data rows, one person name repeated, ONE corrections entry — the label stays unique.
    expect(screen.getAllByText("Riley Report")).toHaveLength(3);
    expect(screen.getAllByLabelText(/^Budget corrections of/)).toHaveLength(1);
    expect(screen.getByLabelText("Budget corrections of Riley Report")).toBeInTheDocument();
  });

  test("the corrections modal receives the person's non-archived pools", async () => {
    renderWithProviders(<DaysOffBudgetsTable />);
    await userEvent.click(await screen.findByLabelText("Budget corrections of Riley Report"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Pool" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Paid days off", "Study leave"]);
  });
});
