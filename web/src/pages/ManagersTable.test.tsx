import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import ManagersTable from "./ManagersTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;


describe("ManagersTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("requests view=managers and renders a manager row", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { userId: 1, name: "Manager One", email: "m1@example.com", teamId: 5, teamName: "alpha" },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
      }),
    );
    renderWithProviders(<ManagersTable />);

    expect(await screen.findByText("Manager One")).toBeInTheDocument();
    expect(screen.getByText("m1@example.com")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/api/v1/teams/members?view=managers");
  });

  test("renders a Provide feedback link per manager row", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { userId: 1, name: "Manager One", email: "m1@example.com", teamId: 5, teamName: "alpha" },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
      }),
    );
    renderWithProviders(<ManagersTable />);

    const link = await screen.findByRole("link", { name: /provide feedback to manager one/i });
    expect(link).toHaveAttribute(
      "href",
      `/feedback/new?subjectId=1&subjectName=Manager%20One&back=${encodeURIComponent("/?tab=managers")}`,
    );
  });

  test("renders an Ask for feedback link per manager row", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { userId: 1, name: "Manager One", email: "m1@example.com", teamId: 5, teamName: "alpha" },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
      }),
    );
    renderWithProviders(<ManagersTable />);

    const link = await screen.findByRole("link", { name: /ask manager one for feedback/i });
    expect(link).toHaveAttribute(
      "href",
      `/feedback/ask?providerId=1&providerName=Manager%20One&back=${encodeURIComponent("/?tab=managers")}`,
    );
  });

  test("renders a 1:1 meetings link per manager row pointing at the per-user screen", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { userId: 1, name: "Manager One", email: "m1@example.com", teamId: 5, teamName: "alpha" },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
      }),
    );
    renderWithProviders(<ManagersTable />);

    const link = await screen.findByRole("link", { name: "1:1 meetings with Manager One" });
    expect(link).toHaveAttribute(
      "href",
      "/users/1/one-on-ones?name=Manager%20One&from=managers",
    );
  });

  test("a manager of two of my teams gets one card with both team badges", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { userId: 1, name: "Manager One", email: "m1@example.com", teamId: 5, teamName: "alpha" },
          { userId: 1, name: "Manager One", email: "m1@example.com", teamId: 9, teamName: "beta" },
        ],
        page: 1,
        pageSize: 100,
        total: 2,
      }),
    );
    renderWithProviders(<ManagersTable />);

    // One card (one name, one set of actions), both teams as badges.
    expect(await screen.findAllByText("Manager One")).toHaveLength(1);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /provide feedback to manager one/i })).toHaveLength(1);
  });

  test("shows an empty state when there are no managers", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 }),
    );
    renderWithProviders(<ManagersTable />);

    expect(await screen.findByText("No managers")).toBeInTheDocument();
  });
});
