import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateUser from "./CreateUser";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const PASSWORD_RE = /^[A-Za-z0-9_-]{16}$/;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderCreateUser() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
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

  test("posts a generated password and reveals it once in the confirmation modal", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 42, name: "Alice", email: "alice@example.com", role: "USER" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderCreateUser();

    // No password inputs on the form anymore.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // The confirmation modal shows the exact password that was POSTed.
    expect(await screen.findByText("User created")).toBeInTheDocument();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      name: "Alice",
      email: "alice@example.com",
      password: expect.stringMatching(PASSWORD_RE),
      role: "USER",
    });
    expect(screen.getByText(body.password)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy password/i })).toBeInTheDocument();
    // Still on the form route until the admin closes the confirmation.
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("closing the confirmation navigates away and the password is gone for good", async () => {
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
    await screen.findByText("User created");
    const password = JSON.parse(mockFetch.mock.calls[0][1].body).password;

    await user.click(screen.getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
  });

  test("copy button copies the generated password to the clipboard", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 42, name: "Alice", email: "alice@example.com", role: "USER" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    // userEvent.setup() installs a working clipboard stub; read it back after copying.
    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("User created");

    await user.click(screen.getByRole("button", { name: /copy password/i }));

    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
    const password = JSON.parse(mockFetch.mock.calls[0][1].body).password;
    await expect(window.navigator.clipboard.readText()).resolves.toBe(password);
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
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("non-admin is redirected to /users", async () => {
    localStorage.setItem(ROLE_KEY, "USER");

    renderCreateUser();

    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(screen.queryByRole("heading", { name: /create user/i })).not.toBeInTheDocument();
  });
});
