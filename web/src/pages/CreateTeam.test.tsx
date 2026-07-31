import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateTeam from "./CreateTeam";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderCreateTeam() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/teams/new"]}>
          <Routes>
            <Route path="/teams/new" element={<CreateTeam />} />
            <Route path="/teams" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}


const MANAGER_POOL = [
  { id: 10, name: "Alice Manager", email: "alice@example.com", roles: ["ADMIN"] as const },
  { id: 11, name: "Bob Manager", email: "bob@example.com", roles: [] as const },
];

function setupMocks(mockFetch: ReturnType<typeof vi.fn>) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.startsWith("/api/v1/users?")) {
      return Promise.resolve(
        jsonResponse(200, {
          items: MANAGER_POOL,
          page: 1,
          pageSize: 100,
          total: MANAGER_POOL.length,
        }),
      );
    }
    return Promise.resolve(jsonResponse(500, {}));
  });
}

describe("CreateTeam page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("admin sees the form with name + manager fields and a prefetched manager pool", async () => {
    setupMocks(mockFetch);
    renderCreateTeam();

    expect(await screen.findByRole("heading", { name: /new team/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    const managerInput = screen.getByLabelText(/manager/i, { selector: "input" });
    expect(managerInput).toBeInTheDocument();

    // Manager picker enables once the user pool prefetch lands.
    await waitFor(() => expect(managerInput).not.toBeDisabled());

    // The pool fetch must hit /api/users with pageSize=100.
    const userCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === "string" && url.startsWith("/api/v1/users?") && url.includes("pageSize=100"),
    );
    expect(userCall).toBeDefined();
  });

  test("client-side validation blocks an empty submission (both fields required)", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderCreateTeam();

    await waitFor(() => {
      const sel = screen.getByLabelText(/manager/i, { selector: "input" }) as HTMLInputElement;
      expect(sel).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/name must be 1–100 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/manager is required/i)).toBeInTheDocument();

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => init?.method === "POST" && url === "/api/v1/teams",
    );
    expect(postCall).toBeUndefined();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("validation still blocks when only the name is filled (manager required)", async () => {
    setupMocks(mockFetch);
    const user = userEvent.setup();
    renderCreateTeam();

    await waitFor(() => {
      const sel = screen.getByLabelText(/manager/i, { selector: "input" }) as HTMLInputElement;
      expect(sel).not.toBeDisabled();
    });

    await user.type(screen.getByLabelText(/name/i), "Platform");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/manager is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/name must be/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
    expect(
      mockFetch.mock.calls.find(([url, init]) => init?.method === "POST" && url === "/api/v1/teams"),
    ).toBeUndefined();
  });

  test("non-admin is redirected to /teams without fetching", () => {
    localStorage.setItem(ROLE_KEY, "[]");
    renderCreateTeam();
    expect(screen.getByTestId("probe")).toHaveTextContent("/teams");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Fill the form (name + manager) and submit. Mocks `POST /api/teams` to `postStatus`.
  function mockWithPostStatus(mockFetch: ReturnType<typeof vi.fn>, postStatus: number) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.startsWith("/api/v1/users?")) {
        return Promise.resolve(
          jsonResponse(200, { items: MANAGER_POOL, page: 1, pageSize: 100, total: MANAGER_POOL.length }),
        );
      }
      if (method === "POST" && url === "/api/v1/teams") return Promise.resolve(jsonResponse(postStatus, {}));
      return Promise.resolve(jsonResponse(500, {}));
    });
  }

  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    const managerInput = screen.getByLabelText(/manager/i, { selector: "input" });
    await waitFor(() => expect(managerInput).not.toBeDisabled());
    await user.type(screen.getByLabelText(/name/i), "Platform");
    fireEvent.click(managerInput); // open the searchable manager combobox
    await user.click(await screen.findByText("Alice Manager"));
    await user.click(screen.getByRole("button", { name: /^create$/i }));
  }

  test("shows a permission error when create is forbidden", async () => {
    mockWithPostStatus(mockFetch, 403);
    const user = userEvent.setup();
    renderCreateTeam();

    await fillAndSubmit(user);
    expect(await screen.findByText(/don't have permission to create teams/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument(); // stayed on the form
  });

  test("maps a 400 from create to a validation message", async () => {
    mockWithPostStatus(mockFetch, 400);
    const user = userEvent.setup();
    renderCreateTeam();

    await fillAndSubmit(user);
    expect(await screen.findByText(/validation error\. please check the form/i)).toBeInTheDocument();
  });
});
