import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import DaysOffTable from "./DaysOffTable";
import type { DaysOffListItem } from "../api/daysoff";

type FetchMock = ReturnType<typeof vi.fn>;

function row(overrides: Partial<DaysOffListItem>): DaysOffListItem {
  return {
    id: 1,
    userId: 9,
    userName: "Riley Report",
    userDeleted: false,
    type: "PAID",
    poolTypeId: 1,
    poolName: "Paid days off",
    startDate: "2099-03-02",
    endDate: "2099-03-04",
    startHalf: false,
    endHalf: false,
    days: 3,
    createdAt: 1_700_000_000_000,
    canDelete: false,
    lastModified: 1_700_000_000_000,
    ...overrides,
  };
}

describe("DaysOffTable", () => {
  let mockFetch: FetchMock;

  function setupList(items: DaysOffListItem[]) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/api/v1/days-off/pool-types")) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              { id: 1, name: "Paid days off", carriesOver: true, isDefault: true },
              { id: 7, name: "Study leave", carriesOver: false, isDefault: false },
            ],
          }),
        );
      }
      if (url.includes("/api/v1/days-off")) {
        return Promise.resolve(jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
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

  test("own view: Delete follows the server's canDelete flag", async () => {
    setupList([
      row({ id: 1, startDate: "2099-03-02", endDate: "2099-03-04", canDelete: true }),
      // A PAST entry is deletable too — no date gate.
      row({ id: 3, startDate: "2001-05-07", endDate: "2001-05-08", canDelete: true }),
      row({ id: 4, startDate: "2099-06-01", endDate: "2099-06-02", canDelete: false }),
    ]);
    renderWithProviders(<DaysOffTable view="own" />);

    expect(await screen.findByLabelText("Delete your days-off entry starting 2099-03-02")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete your days-off entry starting 2001-05-07")).toBeInTheDocument();
    // A non-deletable row gets no action.
    expect(screen.queryByLabelText("Delete your days-off entry starting 2099-06-01")).toBeNull();
    // Own view shows no person column.
    expect(screen.queryByText("Riley Report")).toBeNull();
  });

  test("Delete asks for confirmation, DELETEs, invalidates, and toasts", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    showSpy.mockClear();
    setupList([row({ id: 11, canDelete: true })]);
    renderWithProviders(<DaysOffTable view="own" />);

    await userEvent.click(await screen.findByLabelText("Delete your days-off entry starting 2099-03-02"));
    expect(screen.getByText("Delete this days-off entry?")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/11",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Days-off entry deleted" }));
  });

  test("managed view: Delete follows canDelete and names the owner, person column visible", async () => {
    setupList([
      row({ id: 21, canDelete: true }),
      row({ id: 22, startDate: "2099-05-03", endDate: "2099-05-04", canDelete: false }),
    ]);
    renderWithProviders(<DaysOffTable view="managed" />);

    expect((await screen.findAllByText("Riley Report")).length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText("Delete Riley Report's days-off entry starting 2099-03-02"),
    ).toBeInTheDocument();
    // A non-deletable row gets no action.
    expect(
      screen.queryByLabelText("Delete Riley Report's days-off entry starting 2099-05-03"),
    ).toBeNull();
  });

  test("managed view: a Team column carries the report's team badges (v3.13.0)", async () => {
    setupList([row({ id: 21, canDelete: true, teams: [{ id: 1, name: "AAA" }] })]);
    renderWithProviders(<DaysOffTable view="managed" />, { route: "/days-off?tab=team" });

    expect(await screen.findByRole("columnheader", { name: "Team" })).toBeInTheDocument();
    // The badge links to the team's details view — the shared TeamBadges idiom (Checkup #36 M4)
    // — returning to the tab it sits on (v4.6.0 `back=`).
    expect(await screen.findByRole("link", { name: "Team details for AAA" })).toHaveAttribute(
      "href",
      `/teams/1/details?back=${encodeURIComponent("/days-off?tab=team")}`,
    );
  });

  test("own view: no Team column (the caller is implied)", async () => {
    setupList([row({ id: 1, canDelete: true })]);
    renderWithProviders(<DaysOffTable view="own" />);

    await screen.findByText("Paid days off");
    expect(screen.queryByRole("columnheader", { name: "Team" })).toBeNull();
    expect(screen.queryByText("AAA")).toBeNull();
  });

  test("managed view pinned to one user (a drill-down): no Team column", async () => {
    setupList([row({ id: 21, canDelete: true, teams: [{ id: 1, name: "AAA" }] })]);
    renderWithProviders(<DaysOffTable view="managed" userId={9} />);

    await screen.findByText("Paid days off");
    expect(screen.queryByRole("columnheader", { name: "Team" })).toBeNull();
  });

  test("user (audit) view: read-only rows, no actions", async () => {
    setupList([row({ id: 41, canDelete: false })]);
    renderWithProviders(<DaysOffTable view="user" userId={9} />);

    await screen.findByText("Paid days off");
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    // The pinned user hides the person column.
    expect(screen.queryByText("Riley Report")).toBeNull();
    // The pin rides the query string.
    const listCall = mockFetch.mock.calls.find(([u]) => String(u).includes("view=user"));
    expect(String(listCall?.[0])).toContain("userId=9");
  });

  test("half-day edges carry the ½ marker and days render localized", async () => {
    setupList([row({ id: 51, startHalf: true, days: 2.5 })]);
    renderWithProviders(<DaysOffTable view="own" />);
    await screen.findByText("2.5");
    expect(screen.getByText("½")).toBeInTheDocument();
  });

  test("the From/To cells carry the weekday next to the date", async () => {
    // 2099-03-02 is a Monday, 2099-03-04 a Wednesday (v3.1.0).
    setupList([row({ id: 52, startDate: "2099-03-02", endDate: "2099-03-04" })]);
    renderWithProviders(<DaysOffTable view="own" />);
    expect(await screen.findByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
  });

  /** The query strings of every list request so far (the pool-types registry fetch excluded). */
  const listUrls = () =>
    mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/v1/days-off?"));
  const lastListUrl = () => listUrls().at(-1) ?? "";
  const openTypeFilter = async () => {
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
  };

  test("a paid row names its pool and the Type filter offers All paid, every pool kind and Unpaid in two groups (v3.2.0)", async () => {
    setupList([
      row({ id: 1, poolTypeId: 7, poolName: "Study leave" }),
      row({ id: 2, type: "UNPAID", poolTypeId: null, poolName: null, startDate: "2099-04-06", endDate: "2099-04-06" }),
    ]);
    renderWithProviders(<DaysOffTable view="own" />);

    expect(await screen.findByText("Study leave")).toBeInTheDocument();
    expect(screen.getByText("Unpaid")).toBeInTheDocument();
    await openTypeFilter();
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["All paid", "Paid days off", "Study leave", "Unpaid"]);
    await userEvent.click(screen.getByRole("option", { name: "Study leave" }));
    await waitFor(() => {
      const call = lastListUrl();
      expect(call).toContain("poolTypeId=7");
      expect(call).toContain("type=PAID");
      expect(call).not.toContain("type=UNPAID");
    });
  });

  test("Unpaid plus a pool sends the type set and the pool narrowing; All paid sends type=PAID alone (v4.13.0)", async () => {
    setupList([row({ id: 1 })]);
    renderWithProviders(<DaysOffTable view="own" />);
    await screen.findByText("Paid days off");
    await openTypeFilter();

    await userEvent.click(await screen.findByRole("option", { name: "Unpaid" }));
    await waitFor(() => expect(lastListUrl()).toContain("type=UNPAID"));
    // Only UNPAID picked: no PAID branch, no pool narrowing (the server would 400 on that mix).
    expect(lastListUrl()).not.toContain("type=PAID");
    expect(lastListUrl()).not.toContain("poolTypeId");

    await userEvent.click(screen.getByRole("option", { name: "Study leave" }));
    await waitFor(() => expect(lastListUrl()).toContain("poolTypeId=7"));
    // The type set is repeated (PAID because a pool is picked, then UNPAID) with the pool narrowing.
    expect(lastListUrl()).toContain("type=PAID&type=UNPAID&poolTypeId=7");

    // "All paid" subsumes the individual pools: the last pick wins, the pool pick is dropped.
    await userEvent.click(screen.getByRole("option", { name: "All paid" }));
    await waitFor(() => expect(lastListUrl()).not.toContain("poolTypeId"));
    expect(lastListUrl()).toContain("type=PAID&type=UNPAID");
    expect(JSON.parse(localStorage.getItem("lettuce.viewSettings.daysOff.own.filter.types") ?? "null")).toEqual([
      "UNPAID",
      "PAID",
    ]);

    // And the other way round: picking a pool while "All paid" is selected replaces "All paid".
    await userEvent.click(screen.getByRole("option", { name: "Study leave" }));
    await waitFor(() => expect(lastListUrl()).toContain("poolTypeId=7"));
    expect(JSON.parse(localStorage.getItem("lettuce.viewSettings.daysOff.own.filter.types") ?? "null")).toEqual([
      "UNPAID",
      "pool:7",
    ]);
  });

  test("two pools repeat poolTypeId; All paid alone is type=PAID with no poolTypeId", async () => {
    setupList([row({ id: 1 })]);
    renderWithProviders(<DaysOffTable view="own" />);
    await screen.findByText("Paid days off");
    await openTypeFilter();

    await userEvent.click(await screen.findByRole("option", { name: "Paid days off" }));
    await userEvent.click(screen.getByRole("option", { name: "Study leave" }));
    await waitFor(() => expect(lastListUrl()).toContain("poolTypeId=1&poolTypeId=7"));
    expect(lastListUrl()).toContain("type=PAID");

    await userEvent.click(screen.getByRole("option", { name: "All paid" }));
    await waitFor(() => expect(lastListUrl()).not.toContain("poolTypeId"));
    expect(lastListUrl()).toContain("type=PAID");
    expect(lastListUrl()).not.toContain("type=UNPAID");
  });

  test("a stale stored pool pick (an archived kind) is neither sent nor shown (v3.2.1)", async () => {
    localStorage.setItem(
      "lettuce.viewSettings.daysOff.own.filter.types",
      JSON.stringify(["pool:999", "UNPAID"]),
    );
    setupList([row({ id: 1 })]);
    renderWithProviders(<DaysOffTable view="own" />);
    expect(await screen.findByText("Paid days off")).toBeInTheDocument();
    // The list request waited for the registry, then dropped the archived kind.
    await waitFor(() => expect(listUrls().length).toBeGreaterThan(0));
    expect(listUrls().some((u) => u.includes("poolTypeId=999"))).toBe(false);
    expect(lastListUrl()).toContain("type=UNPAID");
    expect(lastListUrl()).not.toContain("type=PAID");
  });

  test("a legacy scalar type filter under the old key is ignored (new key, v4.13.0)", async () => {
    localStorage.setItem("lettuce.viewSettings.daysOff.own.filter.type", JSON.stringify("pool:7"));
    setupList([row({ id: 1 })]);
    renderWithProviders(<DaysOffTable view="own" />);
    expect(await screen.findByText("Paid days off")).toBeInTheDocument();
    await waitFor(() => expect(listUrls().length).toBeGreaterThan(0));
    expect(listUrls().every((u) => !u.includes("type=") && !u.includes("poolTypeId"))).toBe(true);
  });
});
