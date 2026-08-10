import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ManagerFeedbacks from "./ManagerFeedbacks";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
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
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("shows the two directions as tabs, received active by default and scoped to the manager", async () => {
    renderScreen();

    // Both directions are offered as tabs; only the received panel is mounted initially.
    expect(await screen.findByRole("tab", { name: "From Alice to you" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "From you to Alice" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => u as string);
      // The received list: feedbacks the manager provided to me.
      expect(urls.some((u) => u.includes("view=received") && u.includes("providerId=10"))).toBe(true);
    });
    // The provided list is not fetched until its tab is opened (keepMounted=false).
    expect(mockFetch.mock.calls.map(([u]) => u as string).some((u) => u.includes("view=provided"))).toBe(false);

    await userEvent.click(screen.getByRole("tab", { name: "From you to Alice" }));
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => u as string);
      // The provided list: feedbacks I provided to the manager (all statuses).
      expect(urls.some((u) => u.includes("view=provided") && u.includes("subjectId=10"))).toBe(true);
    });
  });

  test("received rows get a View link, provided drafts get an Edit link, each returning to its tab", async () => {
    renderScreen();

    const viewLink = await screen.findByRole("link", { name: /view feedback from alice/i });
    expect(viewLink).toHaveAttribute("href", expect.stringContaining("/feedback/1/view"));
    expect(viewLink).toHaveAttribute(
      "href",
      expect.stringContaining(`back=${encodeURIComponent("/users/10/feedbacks?name=Alice&tab=received")}`),
    );

    await userEvent.click(screen.getByRole("tab", { name: "From you to Alice" }));
    const editLink = await screen.findByRole("link", { name: /edit feedback for alice/i });
    expect(editLink).toHaveAttribute("href", expect.stringContaining("/feedback/2/edit"));
    expect(editLink).toHaveAttribute(
      "href",
      expect.stringContaining(`back=${encodeURIComponent("/users/10/feedbacks?name=Alice&tab=provided")}`),
    );
  });

  test("the provided tab's New feedback button targets the create flow scoped to the manager", async () => {
    renderScreen();

    await userEvent.click(await screen.findByRole("tab", { name: "From you to Alice" }));
    const back = encodeURIComponent("/users/10/feedbacks?name=Alice&tab=provided");
    const createLink = await screen.findByRole("link", { name: /new feedback for alice/i });
    expect(createLink).toHaveAttribute("href", expect.stringContaining("/feedback/new"));
    expect(createLink).toHaveAttribute("href", expect.stringContaining("subjectId=10"));
    expect(createLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("a ?tab=provided deep link opens the provided tab directly", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&tab=provided");

    expect(await screen.findByRole("tab", { name: "From you to Alice" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("link", { name: /edit feedback for alice/i })).toBeInTheDocument();
    // The received list is not fetched (its panel is unmounted).
    expect(mockFetch.mock.calls.map(([u]) => u as string).some((u) => u.includes("view=received"))).toBe(false);
  });

  test("an invalid ?tab falls back to the received tab", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&tab=nonsense");

    expect(await screen.findByRole("tab", { name: "From Alice to you" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("mode=audit with the HR role replaces the tabs with the auditor table", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    renderScreen("/users/10/feedbacks?name=Alice&from=details&mode=audit");

    expect(await screen.findByText("All feedbacks of Alice")).toBeInTheDocument();
    // No direction tabs in audit mode.
    expect(screen.queryByRole("tab")).toBeNull();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=user") && u.includes("userId=10"))).toBe(true);
    });
  });

  test("mode=audit without an auditor role silently falls back to the pair tabs", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&mode=audit");

    expect(await screen.findByRole("tab", { name: "From Alice to you" })).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("view=received"))).toBe(true);
      expect(urls.some((u) => u.includes("view=user"))).toBe(false);
    });
  });

  test("an invalid user id redirects back to the managers tab", () => {
    renderScreen("/users/abc/feedbacks");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=managers");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("falls back to a placeholder name when none is provided", async () => {
    renderScreen("/users/10/feedbacks");
    expect(await screen.findByRole("tab", { name: "From user #10 to you" })).toBeInTheDocument();
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

    // Edit/Create links return to this peers-scoped screen (back carries from=peers + the tab).
    await userEvent.click(screen.getByRole("tab", { name: "From you to Alice" }));
    const back = encodeURIComponent("/users/10/feedbacks?name=Alice&from=peers&tab=provided");
    const editLink = await screen.findByRole("link", { name: /edit feedback for alice/i });
    expect(editLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
    const createLink = await screen.findByRole("link", { name: /new feedback for alice/i });
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

  test("from=users shows a Back to Users link and redirects invalid ids to /users", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&from=users");
    expect(await screen.findByRole("link", { name: /back to users/i })).toHaveAttribute(
      "href",
      "/users",
    );

    cleanup();
    renderScreen("/users/abc/feedbacks?from=users");
    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
  });

  test("from=members carries the team id into the Back link and the detail-link back params", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&from=members&teamId=3");

    expect(await screen.findByRole("link", { name: /back to team members/i })).toHaveAttribute(
      "href",
      "/teams/3/details",
    );

    // Round-trips keep the origin: back carries from + teamId (+ the active tab).
    const back = encodeURIComponent("/users/10/feedbacks?name=Alice&from=members&teamId=3&tab=received");
    const viewLink = await screen.findByRole("link", { name: /view feedback from alice/i });
    expect(viewLink).toHaveAttribute("href", expect.stringContaining(`back=${back}`));
  });

  test("from=members without a valid teamId degrades to the managers origin", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&from=members");
    expect(await screen.findByRole("link", { name: /back to my managers/i })).toHaveAttribute(
      "href",
      "/?tab=managers",
    );

    cleanup();
    renderScreen("/users/10/feedbacks?name=Alice&from=members&teamId=abc");
    expect(await screen.findByRole("link", { name: /back to my managers/i })).toHaveAttribute(
      "href",
      "/?tab=managers",
    );
  });

  test("from=team returns to the team-scoped subordinates view; without teamId it degrades", async () => {
    renderScreen("/users/10/feedbacks?name=Alice&from=team&teamId=3");
    expect(await screen.findByRole("link", { name: /back to team subordinates/i })).toHaveAttribute(
      "href",
      "/teams/3/details",
    );

    cleanup();
    renderScreen("/users/10/feedbacks?name=Alice&from=team");
    expect(await screen.findByRole("link", { name: /back to my managers/i })).toHaveAttribute(
      "href",
      "/?tab=managers",
    );
  });
});
