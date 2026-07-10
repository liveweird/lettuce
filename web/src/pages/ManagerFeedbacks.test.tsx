import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ManagerFeedbacks from "./ManagerFeedbacks";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;


function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

// A feedback the manager (#10) gave me (#7) — appears in the "received" list.
const RECEIVED_ITEM = {
  id: 1,
  requesterId: null,
  requesterName: null,
  requesterDeleted: false,
  subjectId: 7,
  subjectName: "Me",
  subjectDeleted: false,
  providerId: 10,
  providerName: "Alice",
  providerDeleted: false,
  visibility: "PROVIDER_SUBJECT",
  status: "SENT",
  contentPreview: "Good job",
};

// A draft I (#7) gave the manager (#10) — appears in the "provided" list.
const PROVIDED_ITEM = {
  id: 2,
  requesterId: null,
  requesterName: null,
  requesterDeleted: false,
  subjectId: 10,
  subjectName: "Alice",
  subjectDeleted: false,
  providerId: 7,
  providerName: "Me",
  providerDeleted: false,
  visibility: "PROVIDER_SUBJECT",
  status: "DRAFT",
  contentPreview: "Some notes",
};

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

function renderScreen(path = "/users/10/feedbacks?name=Alice") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/users/:userId/feedbacks" element={<ManagerFeedbacks />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ManagerFeedbacks page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string) => {
      // Return the right slice based on the view scoping in the query string.
      if (url.includes("view=received")) return Promise.resolve(jsonResponse(200, page([RECEIVED_ITEM])));
      if (url.includes("view=provided")) return Promise.resolve(jsonResponse(200, page([PROVIDED_ITEM])));
      return Promise.resolve(jsonResponse(200, page([])));
    });
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders both sections and scopes each list to the manager by id", async () => {
    renderScreen();

    expect(await screen.findByText("From Alice to you")).toBeInTheDocument();
    expect(screen.getByText("From you to Alice")).toBeInTheDocument();

    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => u as string);
      // List 1: feedbacks the manager provided to me.
      expect(urls.some((u) => u.includes("view=received") && u.includes("providerId=10"))).toBe(true);
      // List 2: feedbacks I provided to the manager (all statuses).
      expect(urls.some((u) => u.includes("view=provided") && u.includes("subjectId=10"))).toBe(true);
    });
  });

  test("received rows get a View link, provided drafts get an Edit link, both returning here", async () => {
    renderScreen();

    const back = encodeURIComponent("/users/10/feedbacks?name=Alice");

    const viewLink = await screen.findByRole("link", { name: /view feedback from alice/i });
    expect(viewLink).toHaveAttribute("href", expect.stringContaining("/feedback/1/view"));
    expect(viewLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));

    const editLink = await screen.findByRole("link", { name: /edit feedback for alice/i });
    expect(editLink).toHaveAttribute("href", expect.stringContaining("/feedback/2/edit"));
    expect(editLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("the Create feedback button targets the create flow scoped to the manager", async () => {
    renderScreen();

    const back = encodeURIComponent("/users/10/feedbacks?name=Alice");
    const createLink = await screen.findByRole("link", { name: /create feedback for alice/i });
    expect(createLink).toHaveAttribute("href", expect.stringContaining("/feedback/new"));
    expect(createLink).toHaveAttribute("href", expect.stringContaining("subjectId=10"));
    expect(createLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("an invalid user id redirects back to the managers tab", () => {
    renderScreen("/users/abc/feedbacks");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=managers");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("falls back to a placeholder name when none is provided", async () => {
    renderScreen("/users/10/feedbacks");
    expect(await screen.findByText("From user #10 to you")).toBeInTheDocument();
  });

  test("the Back to My managers link points at the managers tab", async () => {
    renderScreen();
    expect(
      await screen.findByRole("link", { name: /back to my managers/i }),
    ).toHaveAttribute("href", "/?tab=managers");
  });

  test("from=peers shows a Back to My peers link and threads the origin into detail links", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&from=peers");

    expect(
      await screen.findByRole("link", { name: /back to my peers/i }),
    ).toHaveAttribute("href", "/?tab=peers");

    // Edit/Create links return to this peers-scoped screen (back carries from=peers).
    const back = encodeURIComponent("/users/10/feedbacks?name=Alice&from=peers");
    const editLink = await screen.findByRole("link", { name: /edit feedback for alice/i });
    expect(editLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
    const createLink = await screen.findByRole("link", { name: /create feedback for alice/i });
    expect(createLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("an invalid user id from the peers tab redirects back to the peers tab", () => {
    renderScreen("/users/abc/feedbacks?from=peers");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=peers");
  });

  test("from=subordinates shows a Back to My subordinates link", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&from=subordinates");
    expect(
      await screen.findByRole("link", { name: /back to my subordinates/i }),
    ).toHaveAttribute("href", "/?tab=subordinates");
  });
});
