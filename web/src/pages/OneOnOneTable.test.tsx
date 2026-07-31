import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen, within } from "../test/render";
import OneOnOneTable from "./OneOnOneTable";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const ROW = {
  id: 11,
  managerId: 3,
  managerName: "Mia Manager",
  managerDeleted: false,
  subordinateId: 7,
  subordinateName: "Sam Subordinate",
  subordinateDeleted: false,
  meetingDate: "2026-07-01",
  lastModified: Date.now(),
  pointCount: 3,
  decisionCount: 1,
  actionItemCount: 4,
  openActionItemCount: 2,
};

describe("OneOnOneTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", "[]");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("the own view lists meetings newest-first with counts and a view action", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { items: [ROW], page: 1, pageSize: 20, total: 1 }),
    );
    renderWithProviders(<OneOnOneTable view="own" />);

    // The caller (7) is the subordinate; the counterpart column shows the manager.
    expect(await screen.findByText("Mia Manager")).toBeInTheDocument();
    const row = screen.getByText("Mia Manager").closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("3"); // points
    expect(cells).toContain("1"); // decisions
    expect(within(row).getByText("2 of 4 open")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View the 1:1 with Mia Manager" }),
    ).toHaveAttribute("href", "/one-on-ones/11/view?from=own");

    // Default sort is newest meetings first.
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("view=own");
    expect(url).toContain("sort=-meetingDate");
  });

  test("the managed view shows the subordinate and an edit action", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { items: [{ ...ROW, managerId: 7, subordinateId: 8 }], page: 1, pageSize: 20, total: 1 }),
    );
    renderWithProviders(<OneOnOneTable view="managed" />);

    expect(await screen.findByText("Sam Subordinate")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Edit the 1:1 with Sam Subordinate" }),
    ).toHaveAttribute("href", "/one-on-ones/11/edit?from=managed");
  });

  test("an old managed meeting (not the pair's latest) offers View instead of Edit", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { ...ROW, id: 11, managerId: 7, subordinateId: 8, isLatest: false, meetingDate: "2026-06-01" },
          { ...ROW, id: 12, managerId: 7, subordinateId: 8, isLatest: true },
        ],
        page: 1,
        pageSize: 20,
        total: 2,
      }),
    );
    renderWithProviders(<OneOnOneTable view="managed" />);

    // The latest keeps its Edit pencil; the older, immutable one opens read-only.
    expect(
      await screen.findByRole("link", { name: "Edit the 1:1 with Sam Subordinate" }),
    ).toHaveAttribute("href", "/one-on-ones/12/edit?from=managed");
    expect(
      screen.getByRole("link", { name: "View the 1:1 with Sam Subordinate" }),
    ).toHaveAttribute("href", "/one-on-ones/11/view?from=managed");
  });

  test("the team view offers the reports-scope filter that widens to the whole chain", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    renderWithProviders(<OneOnOneTable view="team" />);

    expect(await screen.findByText("No 1:1 meetings.")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.every(([u]) => !String(u).includes("includeIndirect")),
    ).toBe(true);
    // The scope select lives in the (collapsed-by-default) filter panel — assert it exists.
    expect(screen.getByRole("button", { name: /Filters/ })).toBeInTheDocument();
  });

  test("the with view mixes both directions: no filter panel, Edit on own rows, View on theirs", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          ROW, // Mia (3) managed the caller (7) — View
          { ...ROW, id: 12, managerId: 7, managerName: "Me", subordinateId: 3, subordinateName: "Mia Manager" }, // caller managed Mia — Edit
        ],
        page: 1,
        pageSize: 20,
        total: 2,
      }),
    );
    renderWithProviders(<OneOnOneTable view="with" counterpartId={3} backTo="/users/3/one-on-ones?name=Mia" />);

    const back = encodeURIComponent("/users/3/one-on-ones?name=Mia");
    const viewLink = await screen.findByRole("link", { name: "View the 1:1 with Mia Manager" });
    expect(viewLink).toHaveAttribute("href", `/one-on-ones/11/view?from=with&back=${back}`);
    expect(
      screen.getByRole("link", { name: "Edit the 1:1 with Mia Manager" }),
    ).toHaveAttribute("href", `/one-on-ones/12/edit?from=with&back=${back}`);

    // Both parties are fixed, so there is nothing to filter.
    expect(screen.queryByRole("button", { name: /Filters/ })).toBeNull();
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("view=with");
    expect(url).toContain("counterpartId=3");
  });

  test("an empty list renders the empty state", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    renderWithProviders(<OneOnOneTable view="own" />);
    expect(await screen.findByText("No 1:1 meetings.")).toBeInTheDocument();
  });

  test("a load failure renders the error alert without a misleading empty state", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { title: "boom" }));
    renderWithProviders(<OneOnOneTable view="own" />);
    expect(await screen.findByText("Failed to load 1:1 meetings")).toBeInTheDocument();
    expect(screen.queryByText("No 1:1 meetings.")).toBeNull();
  });

  test("the caller's own row renders as plain You, deleted users as plain text", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { ...ROW, id: 11 }, // manager Mia, caller is the subordinate
          { ...ROW, id: 12, managerId: 7, managerName: "Me Myself" }, // caller as manager
        ],
        page: 1,
        pageSize: 20,
        total: 2,
      }),
    );
    renderWithProviders(<OneOnOneTable view="own" />);

    expect(await screen.findByText("Mia Manager")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Me Myself")).toBeNull();
  });

  test("a soft-deleted counterpart carries the (deleted) suffix as plain text", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [{ ...ROW, managerName: "Gone Manager", managerDeleted: true }],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    );
    renderWithProviders(<OneOnOneTable view="own" />);

    const cell = await screen.findByText("Gone Manager (deleted)");
    // Plain text, not a PersonaChip (no avatar initials in the cell).
    expect(cell.closest("tr")!.querySelector(".mantine-Avatar-root")).toBeNull();
  });
});
