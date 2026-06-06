import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateUser from "./CreateUser";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderCreateUser() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/users/new"]}>
          <Routes>
            <Route path="/users/new" element={<CreateUser />} />
            <Route path="/users" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/name/i), "Alice");
  await user.type(screen.getByLabelText(/email/i), "alice@example.com");
  await user.type(screen.getByLabelText(/password/i), "hunter2!");
}

describe("CreateUser page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  });

  test("posts to /api/users and redirects to /users on success", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 42, name: "Alice", email: "alice@example.com", role: "USER" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      name: "Alice",
      email: "alice@example.com",
      password: "hunter2!",
      role: "USER",
    });
  });

  test("409 surfaces an email-field error and keeps the user on the form", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "conflict", message: "Resource already exists" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/email already in use/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("other API errors surface a banner", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } }),
    );

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/create failed \(500\)/i)).toBeInTheDocument();
  });

  test("client-side validation blocks empty submission", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

    const user = userEvent.setup();
    renderCreateUser();

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/name must be 1–50 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("rejects short password client-side", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

    const user = userEvent.setup();
    renderCreateUser();

    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("non-admin is redirected to /users", async () => {
    localStorage.setItem(ROLE_KEY, "USER");

    renderCreateUser();

    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(screen.queryByRole("heading", { name: /create user/i })).not.toBeInTheDocument();
  });
});
