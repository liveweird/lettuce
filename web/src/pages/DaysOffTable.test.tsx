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

  test("a paid row names its pool and the Type filter offers every pool kind (v3.2.0)", async () => {
    setupList([
      row({ id: 1, poolTypeId: 7, poolName: "Study leave" }),
      row({ id: 2, type: "UNPAID", poolTypeId: null, poolName: null, startDate: "2099-04-06", endDate: "2099-04-06" }),
    ]);
    renderWithProviders(<DaysOffTable view="own" />);

    expect(await screen.findByText("Study leave")).toBeInTheDocument();
    expect(screen.getByText("Unpaid")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Any", "Paid", "— Paid days off", "— Study leave", "Unpaid"]);
    await userEvent.click(screen.getByRole("option", { name: "— Study leave" }));
    await waitFor(() => {
      const call = mockFetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes("poolTypeId=7"));
      expect(call).toBeDefined();
      expect(call).toContain("type=PAID");
    });
  });

  test("Paid filters every pool (type=PAID, no poolTypeId) and a stale stored pool pick reads as Any (v3.2.1)", async () => {
    localStorage.setItem("lettuce.viewSettings.daysOff.own.filter.type", JSON.stringify("pool:999"));
    setupList([row({ id: 1 })]);
    renderWithProviders(<DaysOffTable view="own" />);
    expect(await screen.findByText("Paid days off")).toBeInTheDocument();
    // The archived kind's pick is neither sent nor shown.
    const stale = mockFetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes("poolTypeId=999"));
    expect(stale).toBeUndefined();
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("Any");
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(await screen.findByRole("option", { name: "Paid" }));
    await waitFor(() => {
      const call = mockFetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes("type=PAID"));
      expect(call).toBeDefined();
      expect(call).not.toContain("poolTypeId");
    });
  });
});
