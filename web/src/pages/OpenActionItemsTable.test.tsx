import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor, within } from "../test/render";
import { jsonResponse } from "../test/http";
import OpenActionItemsTable from "./OpenActionItemsTable";

type FetchMock = ReturnType<typeof vi.fn>;

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

type Item = {
  id: number;
  content: string;
  owner: "MANAGER" | "SUBORDINATE";
  dueDate: string | null;
  firstAppearedOn: string | null;
  meetingId: number;
  meetingDate: string;
  subordinateId: number;
  subordinateName: string;
};

const OVERDUE: Item = {
  id: 55,
  content: "Send the onboarding plan",
  owner: "MANAGER",
  dueDate: "2026-10-20",
  firstAppearedOn: "2026-09-01",
  meetingId: 31,
  meetingDate: "2026-10-15",
  subordinateId: 8,
  subordinateName: "Sam Subordinate",
};
const DUE_TODAY: Item = {
  id: 56,
  content: "Book the review room",
  owner: "SUBORDINATE",
  dueDate: "2026-10-28",
  firstAppearedOn: null,
  meetingId: 31,
  meetingDate: "2026-10-15",
  subordinateId: 8,
  subordinateName: "Sam Subordinate",
};
const UNDATED: Item = {
  id: 77,
  content: "Think about the roadmap",
  owner: "SUBORDINATE",
  dueDate: null,
  firstAppearedOn: null,
  meetingId: 40,
  meetingDate: "2026-10-22",
  subordinateId: 9,
  subordinateName: "Tina Teammate",
};

function page(items: Item[]) {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length });
}

function listUrls(mockFetch: FetchMock): URL[] {
  return mockFetch.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.startsWith("/api/v1/one-on-ones/action-items?"))
    .map((u) => new URL(u, "http://localhost"));
}

function stub(mockFetch: FetchMock, items: Item[] = [OVERDUE, DUE_TODAY, UNDATED]) {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/v1/one-on-ones/action-items/") && url.endsWith("/history")) {
      return Promise.resolve(
        jsonResponse(200, {
          items: [
            {
              meetingId: 31,
              meetingDate: "2026-10-15",
              actionItemId: 55,
              content: OVERDUE.content,
              owner: "MANAGER",
              dueDate: "2026-10-20",
              resolved: false,
            },
          ],
        }),
      );
    }
    if (url.startsWith("/api/v1/one-on-ones/action-items?")) return Promise.resolve(page(items));
    if (url.startsWith("/api/v1/teams/members")) {
      return Promise.resolve(
        jsonResponse(200, {
          items: [{ userId: 8, name: "Sam Subordinate", email: "sam@x.test", teamId: 1, teamName: "alpha" }],
          page: 1,
          pageSize: 100,
          total: 1,
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderTable(route = "/one-on-ones?tab=action-items") {
  return renderWithProviders(
    <>
      <OpenActionItemsTable />
      <LocationProbe />
    </>,
    { route },
  );
}

async function openFilters() {
  const toggle = await screen.findByRole("button", { name: /^Filters/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await userEvent.click(toggle);
}

describe("OpenActionItemsTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    // Only Date is faked: timers stay real so debounce and waitFor keep working. "Today" is
    // 2026-10-28 in the viewer's local calendar.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 28, 12, 0, 0));
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("lists the open items with report, owner, dates and the default due-date sort", async () => {
    stub(mockFetch);
    renderTable();

    expect(await screen.findByText("Send the onboarding plan")).toBeInTheDocument();
    expect(screen.getByText("Book the review room")).toBeInTheDocument();
    expect(screen.getByText("Think about the roadmap")).toBeInTheDocument();
    expect(screen.getAllByText("Sam Subordinate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tina Teammate").length).toBeGreaterThan(0);

    const rows = screen.getAllByRole("row");
    const overdueRow = rows.find((r) => within(r).queryByText("Send the onboarding plan"))!;
    // A manager-owned item is the caller's own: "You"; the report's item names the report.
    expect(within(overdueRow).getByText("You")).toBeInTheDocument();
    // "Open since" is the first appearance; an item authored in the latest meeting falls back
    // to that meeting's date (Oct 15 for DUE_TODAY).
    expect(within(overdueRow).getByText("Sep 1, 2026")).toBeInTheDocument();
    expect(within(overdueRow).getByText("Oct 15, 2026")).toBeInTheDocument();
    const todayRow = rows.find((r) => within(r).queryByText("Book the review room"))!;
    expect(within(todayRow).getAllByText("Oct 15, 2026")).toHaveLength(2);
    expect(within(todayRow).getByText("Sam Subordinate", { selector: "p" })).toBeInTheDocument();

    const urls = listUrls(mockFetch);
    expect(urls[0].searchParams.get("sort")).toBe("dueDate");
    expect(urls[0].searchParams.get("owner")).toBeNull();
    expect(urls[0].searchParams.get("subordinateId")).toBeNull();
  });

  test("a past due date is set in the error ink AND labelled Overdue; today, future and undated are not", async () => {
    stub(mockFetch);
    renderTable();

    await screen.findByText("Send the onboarding plan");
    // Exactly one item (the Oct 20 one) is overdue on the fixed 2026-10-28 clock.
    const labels = screen.getAllByText("Overdue");
    expect(labels).toHaveLength(1);
    const overdueRow = screen.getAllByRole("row").find((r) => within(r).queryByText("Send the onboarding plan"))!;
    expect(within(overdueRow).getByText("Overdue")).toBeInTheDocument();
    const date = within(overdueRow).getByText("Oct 20, 2026");
    // Same error ink on the date and on its text label (the token resolves to a concrete red).
    const ink = getComputedStyle(date).color;
    expect(ink).not.toBe("");
    expect(getComputedStyle(within(overdueRow).getByText("Overdue")).color).toBe(ink);
    // Due today is not overdue; an undated item shows the dash.
    const todayRow = screen.getAllByRole("row").find((r) => within(r).queryByText("Book the review room"))!;
    expect(within(todayRow).getByText("Oct 28, 2026")).toBeInTheDocument();
    expect(getComputedStyle(within(todayRow).getByText("Oct 28, 2026")).color).not.toBe(ink);
    expect(within(todayRow).queryByText("Overdue")).toBeNull();
    const undatedRow = screen.getAllByRole("row").find((r) => within(r).queryByText("Think about the roadmap"))!;
    expect(within(undatedRow).getByText("—")).toBeInTheDocument();
  });

  test("the Owner filter sends the owner param; All drops it again", async () => {
    stub(mockFetch);
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("Send the onboarding plan");

    await openFilters();
    await user.click(screen.getByRole("combobox", { name: "Owner" }));
    await user.click(await screen.findByRole("option", { name: "You" }));
    await waitFor(() => expect(listUrls(mockFetch).some((u) => u.searchParams.get("owner") === "MANAGER")).toBe(true));

    await user.click(screen.getByRole("combobox", { name: "Owner" }));
    await user.click(await screen.findByRole("option", { name: "Team member" }));
    await waitFor(() =>
      expect(listUrls(mockFetch).some((u) => u.searchParams.get("owner") === "SUBORDINATE")).toBe(true),
    );

    await user.click(screen.getByRole("combobox", { name: "Owner" }));
    await user.click(await screen.findByRole("option", { name: "All" }));
    await waitFor(() => expect(listUrls(mockFetch).at(-1)!.searchParams.get("owner")).toBeNull());
  });

  test("the team member name filter sends subordinateName (debounced)", async () => {
    stub(mockFetch);
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("Send the onboarding plan");

    await openFilters();
    await user.type(screen.getByRole("textbox", { name: "Team member" }), "tina");
    await waitFor(() =>
      expect(listUrls(mockFetch).at(-1)!.searchParams.get("subordinateName")).toBe("tina"),
    );
  });

  test("?subordinateId= filters the list and shows a clearable chip named from the rows", async () => {
    stub(mockFetch, [OVERDUE, DUE_TODAY]);
    const user = userEvent.setup();
    renderTable("/one-on-ones?tab=action-items&subordinateId=8");

    expect(await screen.findByText("Only items with Sam Subordinate")).toBeInTheDocument();
    expect(listUrls(mockFetch)[0].searchParams.get("subordinateId")).toBe("8");

    await user.click(screen.getByRole("button", { name: "Show items with all team members" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/one-on-ones?tab=action-items"));
    expect(screen.getByTestId("location").textContent).not.toContain("subordinateId");
    expect(screen.queryByText(/Only items with/)).toBeNull();
    await waitFor(() => expect(listUrls(mockFetch).at(-1)!.searchParams.get("subordinateId")).toBeNull());
  });

  test("a ?subordinateId= deep link clears stored owner/name filters so it shows the person's full open set", async () => {
    localStorage.setItem("lettuce.viewSettings.oneOnOnes.openActionItems.filter.owner", JSON.stringify("SUBORDINATE"));
    localStorage.setItem("lettuce.viewSettings.oneOnOnes.openActionItems.filter.subordinate", JSON.stringify("tina"));
    stub(mockFetch, [OVERDUE, DUE_TODAY]);
    renderTable("/one-on-ones?tab=action-items&subordinateId=8");

    expect(await screen.findByText("Only items with Sam Subordinate")).toBeInTheDocument();
    const urls = listUrls(mockFetch);
    // Every request, the first included, goes out without the stored filters.
    for (const url of urls) {
      expect(url.searchParams.get("owner")).toBeNull();
      expect(url.searchParams.get("subordinateName")).toBeNull();
    }
    expect(urls[0].searchParams.get("subordinateId")).toBe("8");
  });

  test("the chip is named from the reports pool when the filtered page is empty", async () => {
    stub(mockFetch, []);
    renderTable("/one-on-ones?tab=action-items&subordinateId=8");

    expect(await screen.findByText("Only items with Sam Subordinate")).toBeInTheDocument();
    // Empty AND filtered: the distinct copy.
    expect(screen.getByText("No open action items match these filters.")).toBeInTheDocument();
  });

  test("a non-numeric subordinateId in the URL is ignored", async () => {
    stub(mockFetch);
    renderTable("/one-on-ones?tab=action-items&subordinateId=abc");

    await screen.findByText("Send the onboarding plan");
    expect(screen.queryByText(/Only items with/)).toBeNull();
    expect(listUrls(mockFetch)[0].searchParams.get("subordinateId")).toBeNull();
  });

  test("Open meeting links to the editor and returns to this tab", async () => {
    stub(mockFetch, [OVERDUE]);
    renderTable("/one-on-ones?tab=action-items&subordinateId=8");

    const link = await screen.findByRole("link", { name: "Open the 1:1 with Sam Subordinate" });
    expect(link).toHaveAttribute(
      "href",
      `/one-on-ones/31/edit?from=managed&back=${encodeURIComponent("/one-on-ones?tab=action-items&subordinateId=8")}`,
    );
  });

  test("History opens the action item history modal for that item", async () => {
    stub(mockFetch, [OVERDUE]);
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Send the onboarding plan");
    await user.click(screen.getByRole("button", { name: "More actions for Sam Subordinate" }));
    await user.click(await screen.findByRole("menuitem", { name: "History of the action item for Sam Subordinate" }));

    expect(await screen.findByText("Action item history")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => String(u) === "/api/v1/one-on-ones/action-items/55/history"),
      ).toBe(true),
    );
  });

  test("an empty list shows the empty state", async () => {
    stub(mockFetch, []);
    renderTable();

    expect(await screen.findByText("No open action items.")).toBeInTheDocument();
  });

  test("the sortable headers request the whitelisted sort fields, toggling direction", async () => {
    stub(mockFetch);
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("Send the onboarding plan");

    // Due date is the active sort (asc): a second click flips it to descending.
    await user.click(screen.getByRole("button", { name: "Due date" }));
    await waitFor(() => expect(listUrls(mockFetch).at(-1)!.searchParams.get("sort")).toBe("-dueDate"));

    await user.click(screen.getByRole("button", { name: "Meeting date" }));
    await waitFor(() => expect(listUrls(mockFetch).at(-1)!.searchParams.get("sort")).toBe("meetingDate"));

    await user.click(screen.getByRole("button", { name: "Team member" }));
    await waitFor(() => expect(listUrls(mockFetch).at(-1)!.searchParams.get("sort")).toBe("subordinateName"));
  });
});
