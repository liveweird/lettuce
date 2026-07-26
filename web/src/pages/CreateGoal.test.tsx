import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateGoal from "./CreateGoal";
import { jsonResponse } from "../test/http";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

// One person on two teams — the picker must dedupe to a single option.
const REPORTS = {
  items: [
    { userId: 8, name: "Sam Subordinate", email: "sam@example.com", teamId: 1, teamName: "alpha" },
    { userId: 8, name: "Sam Subordinate", email: "sam@example.com", teamId: 2, teamName: "beta" },
    { userId: 11, name: "Bob Brown", email: "bob@example.com", teamId: 1, teamName: "alpha" },
  ],
  page: 1,
  pageSize: 100,
  total: 3,
};

const CREATED = {
  id: 42,
  managerId: 7,
  managerName: "Me",
  subordinateId: 8,
  subordinateName: "Sam Subordinate",
  createdAt: Date.now(),
  title: "Ship it",
  description: "",
  type: "NUMBER",
  targetValue: 4,
  currentValue: 0,
  achieved: null,
  status: "DRAFT",
  summary: null,
  lastModified: Date.now(),
};

function renderScreen(route = "/goals/new") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/goals/new" element={<CreateGoal />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateGoal page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "POST" && u === "/api/v1/goals") {
        return Promise.resolve(jsonResponse(201, CREATED));
      }
      if (u.includes("/api/v1/teams/members")) {
        return Promise.resolve(jsonResponse(200, REPORTS));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
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

  async function fillDefinition(user: ReturnType<typeof userEvent.setup>, title = "Ship it") {
    await user.type(await screen.findByLabelText(/title/i), title);
    const target = screen.getByLabelText(/target/i);
    await user.clear(target);
    await user.type(target, "4");
  }

  test("picks a deduped direct report, creates, and lands in the goal's editor", async () => {
    const user = userEvent.setup();
    renderScreen();

    // Create stays disabled until a team member is picked.
    await fillDefinition(user);
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Team member", { selector: "input" }));
    const options = await screen.findAllByRole("option", { name: "Sam Subordinate" });
    expect(options).toHaveLength(1); // two team rows, one person
    fireEvent.click(options[0]);

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("/goals/42/edit?from=managed");
    });
    const post = mockFetch.mock.calls.find(
      ([u, init]) => String(u) === "/api/v1/goals" && (init as RequestInit)?.method === "POST",
    );
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      subordinateId: 8,
      title: "Ship it",
      description: "",
      type: "NUMBER",
      targetValue: 4,
    });
  });

  test("a prefilled subordinate renders read-only, skips the picker fetch, and keeps back", async () => {
    const user = userEvent.setup();
    renderScreen(
      "/goals/new?subordinateId=8&subordinateName=Sam%20Subordinate&back=%2Fusers%2F8%2Fgoals%3Ffrom%3Dsubordinates",
    );

    expect(await screen.findByText("Sam Subordinate")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Team member" })).toBeNull();
    expect(
      mockFetch.mock.calls.every(([u]) => !String(u).includes("/api/v1/teams/members")),
    ).toBe(true);

    await fillDefinition(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "/goals/42/edit?from=managed&back=%2Fusers%2F8%2Fgoals%3Ffrom%3Dsubordinates",
      );
    });
  });

  test("a BINARY goal posts a null target and hides the target input", async () => {
    const user = userEvent.setup();
    renderScreen("/goals/new?subordinateId=8&subordinateName=Sam");

    await user.type(await screen.findByLabelText(/title/i), "Get certified");
    fireEvent.click(screen.getByLabelText("Type", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Done / not done" }));
    expect(screen.queryByLabelText(/target/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([u, init]) => String(u) === "/api/v1/goals" && (init as RequestInit)?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toMatchObject({
        type: "BINARY",
        targetValue: null,
      });
    });
  });

  test("validation blocks a blank title and a missing target", async () => {
    const user = userEvent.setup();
    renderScreen("/goals/new?subordinateId=8&subordinateName=Sam");

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText("A title is required")).toBeInTheDocument();
    expect(
      screen.getByText("A target value is required for this goal type"),
    ).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  test("Cancel opens the discard confirm; discarding returns to back", async () => {
    const user = userEvent.setup();
    renderScreen("/goals/new?subordinateId=8&back=%2F%3Ftab%3Dsubordinates");

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=subordinates"));
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  test("a 403 shows the direct-report message and stays on the form", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(jsonResponse(403, { title: "no" }));
      }
      return Promise.resolve(jsonResponse(200, REPORTS));
    });
    const user = userEvent.setup();
    renderScreen("/goals/new?subordinateId=8&subordinateName=Sam");

    await fillDefinition(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(
      await screen.findByText("You may only set goals for your direct reports."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });
});
