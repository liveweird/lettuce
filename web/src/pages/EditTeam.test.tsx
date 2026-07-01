import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditTeam from "./EditTeam";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TEAM = { id: 2, name: "Platform", managerId: 10, memberIds: [1, 2] };
const MANAGER_POOL = {
  items: [
    { id: 10, name: "Mona Manager", email: "mona@example.com", role: "ADMIN" as const },
    { id: 11, name: "Bob Manager", email: "bob@example.com", role: "USER" as const },
  ],
  page: 1,
  pageSize: 100,
  total: 2,
};

function renderEditTeam(id: number | string = 2) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/teams/${id}/edit`]}>
          <Routes>
            <Route path="/teams/:id/edit" element={<EditTeam />} />
            <Route path="/teams" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("EditTeam page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("pre-fills the form, PUTs edits (preserving members) and redirects to /teams", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/v1/teams/2") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/v1/teams/2") return Promise.resolve(jsonResponse(200, TEAM));
      if (url.startsWith("/api/v1/users?")) return Promise.resolve(jsonResponse(200, MANAGER_POOL));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditTeam(2);

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("Platform"));

    await user.clear(nameInput);
    await user.type(nameInput, "Platform X");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/teams"));

    const putCall = mockFetch.mock.calls.find(
      ([u, init]) => (init as RequestInit | undefined)?.method === "PUT" && u === "/api/v1/teams/2",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({
      name: "Platform X",
      managerId: 10,
      memberIds: [1, 2],
    });
  });

  test.each([
    [403, /don't have permission to edit this team/i],
    [404, /team no longer exists/i],
    [400, /validation error/i],
    [500, /edit failed \(500\)/i],
  ])("a %i on save surfaces an error and stays on the editor", async (status, pattern) => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/v1/teams/2") {
        return Promise.resolve(jsonResponse(status, { error: "e", message: "no" }));
      }
      if (url === "/api/v1/teams/2") return Promise.resolve(jsonResponse(200, TEAM));
      if (url.startsWith("/api/v1/users?")) return Promise.resolve(jsonResponse(200, MANAGER_POOL));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditTeam(2);

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("Platform"));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(pattern)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("404 on GET shows a 'Team not found' alert with a back link", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/teams/2") {
        return Promise.resolve(jsonResponse(404, { error: "not_found", message: "missing" }));
      }
      if (url.startsWith("/api/v1/users?")) return Promise.resolve(jsonResponse(200, MANAGER_POOL));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderEditTeam(2);

    expect(await screen.findByText(/team not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to teams/i })).toHaveAttribute("href", "/teams");
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  test("non-admin is redirected to /teams without fetching", () => {
    localStorage.setItem(ROLE_KEY, "USER");
    renderEditTeam(2);
    expect(screen.getByTestId("probe")).toHaveTextContent("/teams");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
