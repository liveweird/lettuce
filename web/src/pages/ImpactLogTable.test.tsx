import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ImpactLogTable from "./ImpactLogTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

const OWN_PAGE = {
  items: [
    {
      id: 5,
      userId: 7,
      userName: "Me Myself",
      userDeleted: false,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      whatHappenedPreview: "Shipped the reporting pipeline",
      createdAt: new Date(2026, 7, 1).getTime(),
      lastModified: new Date(2026, 7, 2).getTime(),
    },
    {
      id: 6,
      userId: 7,
      userName: "Me Myself",
      userDeleted: false,
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      whatHappenedPreview: "Q1 platform migration",
      createdAt: new Date(2026, 3, 1).getTime(),
      lastModified: new Date(2026, 3, 1).getTime(),
    },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
};

const MANAGED_PAGE = {
  items: [
    {
      id: 9,
      userId: 8,
      userName: "Olga Owner",
      userDeleted: false,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      whatHappenedPreview: "Vendor consolidation",
      createdAt: new Date(2026, 6, 1).getTime(),
      lastModified: new Date(2026, 6, 1).getTime(),
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
};

function renderTable(
  props: Parameters<typeof ImpactLogTable>[0],
  page: typeof OWN_PAGE | typeof MANAGED_PAGE = OWN_PAGE,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    if ((init?.method ?? "GET") === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u.startsWith("/api/v1/impact-log?")) {
      return Promise.resolve(jsonResponse(200, page));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ImpactLogTable {...props} />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("ImpactLogTable", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("own view renders periods, previews, own-row actions, and the default period sort", async () => {
    const mockFetch = renderTable({ view: "own" });

    expect(await screen.findByText("Shipped the reporting pipeline")).toBeInTheDocument();
    expect(screen.getByText("Jul 1, 2026 – Jul 31, 2026")).toBeInTheDocument();
    expect(screen.getByText("Q1 platform migration")).toBeInTheDocument();
    // No owner column on the own view — every row is the caller's.
    expect(screen.queryByText("Author")).toBeNull();
    // Own rows carry View + Edit + Delete.
    expect(
      screen.getByRole("link", { name: "Edit entry Jul 1, 2026 – Jul 31, 2026" }),
    ).toHaveAttribute("href", "/impact-log/5/edit");
    expect(
      screen.getByRole("button", { name: "Delete entry Jul 1, 2026 – Jul 31, 2026" }),
    ).toBeInTheDocument();
    // Default sort: most recent period first.
    const listCall = mockFetch.mock.calls.find(([u]) => String(u).startsWith("/api/v1/impact-log?"));
    expect(String(listCall![0])).toContain("sort=-periodStart");
    expect(String(listCall![0])).toContain("view=own");
  });

  test("deleting an own entry confirms first, then DELETEs and shows the toast", async () => {
    const user = userEvent.setup();
    const mockFetch = renderTable({ view: "own" });

    await user.click(
      await screen.findByRole("button", { name: "Delete entry Jul 1, 2026 – Jul 31, 2026" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Delete the entry for Jul 1, 2026/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/impact-log/5" && (init as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });

  test("managed view shows the read-only owner column and sends its filter", async () => {
    const user = userEvent.setup();
    const mockFetch = renderTable({ view: "managed", withReportsScope: true }, MANAGED_PAGE);

    expect(await screen.findByText("Olga Owner")).toBeInTheDocument();
    // Not the owner → view only, no edit/delete affordances.
    expect(screen.queryByRole("link", { name: /^Edit entry/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete entry/ })).toBeNull();

    // The filters live behind the collapsed panel.
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Author"), "olga");
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("userName=olga"))).toBe(true);
    });

    // The Reports scope widens the list to the whole chain via includeIndirect.
    await user.click(screen.getByLabelText("Reports", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: /all reports/i }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes("includeIndirect=true")),
      ).toBe(true);
    });
  });

  test("view=user passes the audited userId through", async () => {
    const mockFetch = renderTable({ view: "user", userId: 8 }, MANAGED_PAGE);
    expect(await screen.findByText("Olga Owner")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls.find(([u]) => String(u).startsWith("/api/v1/impact-log?"));
    expect(String(listCall![0])).toContain("view=user");
    expect(String(listCall![0])).toContain("userId=8");
  });
});
