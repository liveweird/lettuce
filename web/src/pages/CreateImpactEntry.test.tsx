import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateImpactEntry from "./CreateImpactEntry";
import { jsonResponse } from "../test/http";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const CREATED = {
  id: 5,
  userId: 7,
  userName: "Me Myself",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  whatHappened: "Shipped it",
  contribution: "Built it",
  whyItMattered: "It mattered",
  evidence: "Kudos",
  createdAt: Date.now(),
  lastModified: Date.now(),
};

function renderScreen(route = "/impact-log/new") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/impact-log/new" element={<CreateImpactEntry />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateImpactEntry page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "POST" && u === "/api/v1/impact-log") {
        return Promise.resolve(jsonResponse(201, CREATED));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
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

  async function fillSections(user: ReturnType<typeof userEvent.setup>) {
    // The markdown editors load lazily — wait for the first before typing.
    await user.type(await screen.findByLabelText("What happened"), "Shipped it");
    await user.type(screen.getByLabelText("My contribution"), "Built it");
    await user.type(screen.getByLabelText("Why did it matter"), "It mattered");
    await user.type(
      screen.getByLabelText("What evidence / feedback supports that"),
      "Kudos",
    );
  }

  test("creates an entry in the caller's own journal and returns to back", async () => {
    const user = userEvent.setup();
    renderScreen("/impact-log/new?back=%2Fimpact-log");

    // The owner is fixed: the caller, rendered as plain "You" — no picker exists.
    expect(await screen.findByText("You")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: "2026-07-31" } });
    await fillSections(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log"));
    const post = mockFetch.mock.calls.find(
      ([u, init]) => String(u) === "/api/v1/impact-log" && (init as RequestInit)?.method === "POST",
    );
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      whatHappened: "Shipped it",
      contribution: "Built it",
      whyItMattered: "It mattered",
      evidence: "Kudos",
    });
  });

  test("moving the period start past the end drags the end along (the range nudge)", async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(/period end/i), {
      target: { value: "2026-07-10" },
    });
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: "2026-08-01" } });
    expect(screen.getByLabelText(/period end/i)).toHaveValue("2026-08-01");
  });

  test("blank sections block the create with per-section errors", async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText("What happened");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findAllByText("This section is required")).toHaveLength(4);
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  test("Cancel opens the discard confirm; discarding returns to back", async () => {
    const user = userEvent.setup();
    renderScreen("/impact-log/new?back=%2Fimpact-log");

    await screen.findByLabelText("What happened");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discard entry?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^discard$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log"));
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  test("a save failure shows the inline error and stays on the form", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(jsonResponse(500, { title: "boom" }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    const user = userEvent.setup();
    renderScreen();

    fireEvent.change(await screen.findByLabelText(/period start/i), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: "2026-07-31" } });
    await fillSections(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(
      await screen.findByText("Failed to save the entry (HTTP 500)."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });
});
