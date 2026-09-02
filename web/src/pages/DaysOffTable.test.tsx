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
    status: "REQUESTED",
    startDate: "2099-03-02",
    endDate: "2099-03-04",
    startHalf: false,
    endHalf: false,
    days: 3,
    createdAt: 1_700_000_000_000,
    cancelledAt: null,
    cancelledByName: null,
    cancelReason: null,
    canCancel: false,
    canResolve: false,
    lastModified: 1_700_000_000_000,
    ...overrides,
  };
}

describe("DaysOffTable", () => {
  let mockFetch: FetchMock;

  function setupList(items: DaysOffListItem[]) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
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

  test("own view: Cancel follows the server's canCancel flag — date-independent (v2.31.0)", async () => {
    setupList([
      row({ id: 1, status: "REQUESTED", startDate: "2099-03-02", endDate: "2099-03-04", canCancel: true }),
      // A PAST accepted request is cancellable now — the old before-start-date gate is gone.
      row({ id: 3, status: "ACCEPTED", startDate: "2001-05-07", endDate: "2001-05-08", canCancel: true }),
      row({ id: 4, status: "REJECTED", startDate: "2099-06-01", endDate: "2099-06-02" }),
    ]);
    renderWithProviders(<DaysOffTable view="own" />);

    await screen.findByText("Rejected");
    expect(screen.getByLabelText("Cancel your days-off request starting 2099-03-02")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel your days-off request starting 2001-05-07")).toBeInTheDocument();
    // Terminal rows carry canCancel=false and get no action.
    expect(screen.queryByLabelText("Cancel your days-off request starting 2099-06-01")).toBeNull();
    // Own view shows no person column.
    expect(screen.queryByText("Riley Report")).toBeNull();
  });

  test("cancel demands a reason, POSTs it, and toasts", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    showSpy.mockClear();
    setupList([row({ id: 11, status: "REQUESTED", canCancel: true })]);
    renderWithProviders(<DaysOffTable view="own" />);

    await userEvent.click(await screen.findByLabelText("Cancel your days-off request starting 2099-03-02"));
    expect(screen.getByText("Cancel this request?")).toBeInTheDocument();
    // The reason is obligatory: confirming blank shows the field error and sends nothing.
    await userEvent.click(screen.getByRole("button", { name: "Cancel the request" }));
    expect(screen.getByText("A cancellation reason is required")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/cancel"))).toBe(false);

    await userEvent.type(screen.getByLabelText(/^Reason/), "Project deadline moved");
    await userEvent.click(screen.getByRole("button", { name: "Cancel the request" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/11/cancel",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "Project deadline moved" }),
        }),
      );
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Request cancelled" }));
  });

  test("managed view: Accept and Reject on pending rows, person column visible", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    setupList([
      row({ id: 21, status: "REQUESTED", canResolve: true }),
      row({ id: 22, status: "ACCEPTED", startDate: "2099-05-03", endDate: "2099-05-04", canCancel: true }),
    ]);
    renderWithProviders(<DaysOffTable view="managed" />);

    expect((await screen.findAllByText("Riley Report")).length).toBeGreaterThan(0);
    await userEvent.click(
      screen.getByLabelText("Accept the days-off request of Riley Report starting 2099-03-02"),
    );
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/21/accept",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Request accepted" }));
    // The accepted row is no longer accept-able, but a managing caller may now cancel it
    // (v2.31.0) — the manager-worded aria.
    expect(
      screen.queryByLabelText("Accept the days-off request of Riley Report starting 2099-05-03"),
    ).toBeNull();
    expect(
      screen.getByLabelText("Cancel Riley Report's days-off request starting 2099-05-03"),
    ).toBeInTheDocument();
  });

  test("reject goes through the confirmation modal", async () => {
    setupList([row({ id: 31, status: "REQUESTED", canResolve: true })]);
    renderWithProviders(<DaysOffTable view="managed" />);

    await userEvent.click(
      await screen.findByLabelText("Reject the days-off request of Riley Report starting 2099-03-02"),
    );
    expect(screen.getByText("Reject this request?")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Reject" }).at(-1)!);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/31/reject",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  test("a cancelled row's popover reveals the reason and the cancellation by-line", async () => {
    setupList([
      row({
        id: 51,
        status: "CANCELLED",
        cancelReason: "Team offsite clashed",
        cancelledByName: "Morgan Manager",
        cancelledAt: 1_700_000_000_000,
      }),
    ]);
    renderWithProviders(<DaysOffTable view="own" />);

    await screen.findByText("Cancelled");
    await userEvent.click(screen.getByLabelText("Cancellation reason"));
    expect(await screen.findByText("Team offsite clashed")).toBeInTheDocument();
    expect(screen.getByText(/Morgan Manager ·/)).toBeInTheDocument();
  });

  test("a pre-rework cancelled row (no stored reason) gets no popover affordance", async () => {
    setupList([row({ id: 52, status: "CANCELLED" })]);
    renderWithProviders(<DaysOffTable view="own" />);

    await screen.findByText("Cancelled");
    expect(screen.queryByLabelText("Cancellation reason")).toBeNull();
  });

  test("user (audit) view: read-only rows, no actions", async () => {
    setupList([row({ id: 41, status: "REQUESTED" })]);
    renderWithProviders(<DaysOffTable view="user" userId={9} />);

    await screen.findByText("Requested");
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
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
});
