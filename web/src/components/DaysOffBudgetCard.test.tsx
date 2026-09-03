import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import DaysOffBudgetCard from "./DaysOffBudgetCard";

type FetchMock = ReturnType<typeof vi.fn>;

const YEAR = 2026;
const DEFAULT_POOL = {
  userId: 5, userName: "Me", userDeleted: false, year: YEAR,
  poolId: 41, poolTypeId: 1, poolName: "Paid days off", carriesOver: true, isDefault: true, poolArchived: false,
  allowance: 20, carriedOver: 2, corrected: 0, reserved: 1.5, used: 3, remaining: 17.5, canCorrect: false,
};
const STUDY_POOL = {
  ...DEFAULT_POOL, poolId: 42, poolTypeId: 7, poolName: "Study leave", carriesOver: false, isDefault: false,
  allowance: 3, carriedOver: 0, corrected: 0.5, reserved: 0, used: 1, remaining: 2.5,
};
const ARCHIVED_POOL = {
  ...STUDY_POOL, poolId: null, poolTypeId: 8, poolName: "Old pool", poolArchived: true,
  allowance: null, corrected: 0, reserved: 1, used: 0, remaining: -1,
};

describe("DaysOffBudgetCard", () => {
  let mockFetch: FetchMock;

  function setupMocks(items: unknown[]) {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(200, { items })));
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "5");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a lone default pool renders untitled, as before the pools", async () => {
    setupMocks([DEFAULT_POOL]);
    renderWithProviders(<DaysOffBudgetCard year={YEAR} />);
    expect(await screen.findByText("17.5")).toBeInTheDocument();
    expect(screen.queryByText("Paid days off")).toBeNull();
    // The group role still names the pool for assistive tech, untitled or not.
    expect(screen.getByRole("group", { name: "Paid days off" })).toBeInTheDocument();
    // Corrections at 0 are omitted; the allowance shows.
    expect(screen.queryByText("Corrections", { selector: "p" })).toBeNull();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  test("several pools render one titled group each — the archived one badged, the reset one cued (v3.2.0)", async () => {
    setupMocks([DEFAULT_POOL, STUDY_POOL, ARCHIVED_POOL]);
    renderWithProviders(<DaysOffBudgetCard year={YEAR} />);
    expect(await screen.findByRole("group", { name: "Study leave" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Paid days off" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Old pool" })).toBeInTheDocument();
    expect(screen.getByText("resets yearly")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("+0.5")).toBeInTheDocument();
  });

  test("no rows renders the empty note, not a skeleton (v3.2.1)", async () => {
    setupMocks([]);
    renderWithProviders(<DaysOffBudgetCard year={YEAR} />);
    expect(await screen.findByText("No paid pools yet.")).toBeInTheDocument();
  });

  test("an ungranted default pool shows the orange hint", async () => {
    setupMocks([{ ...DEFAULT_POOL, poolId: null, allowance: null, remaining: 0 }]);
    renderWithProviders(<DaysOffBudgetCard year={YEAR} />);
    expect(await screen.findByText(/No allowance is configured for your default paid pool yet/)).toBeInTheDocument();
  });
});
