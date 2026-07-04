import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChangeUserPassword from "./ChangeUserPassword";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderChangePassword(id: number | string = 7) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/users/${id}/change-password`]}>
          <Routes>
            <Route path="/users/:id/change-password" element={<ChangeUserPassword />} />
            <Route path="/users" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}


const EXISTING_USER = { id: 7, name: "Alice", email: "alice@example.com", role: "USER" as const };

describe("ChangeUserPassword page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

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

  test("PUTs the new password to /api/users/:id/password and redirects to /users", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const user = userEvent.setup();
    renderChangePassword(7);

    // Admin (not user 7) resets another user's password: no current-password field.
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    await user.type(await screen.findByLabelText("New password"), "hunter2!42");
    await user.type(screen.getByLabelText("Confirm password"), "hunter2!42");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));

    const putCall = mockFetch.mock.calls.find(([url]) => url === "/api/v1/users/7/password");
    expect(putCall).toBeTruthy();
    expect(putCall![1]).toEqual(expect.objectContaining({ method: "PUT" }));
    expect(JSON.parse(putCall![1].body)).toEqual({ password: "hunter2!42" });
  });

  test("rejects mismatched confirmation client-side", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));

    const user = userEvent.setup();
    renderChangePassword(7);

    await user.type(await screen.findByLabelText("New password"), "hunter2!42");
    await user.type(screen.getByLabelText("Confirm password"), "hunter3!42");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/v1/users/7/password")).toBe(false);
  });

  test("rejects short password client-side", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));

    const user = userEvent.setup();
    renderChangePassword(7);

    await user.type(await screen.findByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "short");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    expect(await screen.findByText(/password must be at least 10 characters/i)).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/v1/users/7/password")).toBe(false);
  });

  test("non-admin changing another user is redirected to /users", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "99");

    renderChangePassword(7);

    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  test("non-admin changing their OWN password provides the current one and PUTs both", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const user = userEvent.setup();
    renderChangePassword(7);

    await user.type(await screen.findByLabelText("Current password"), "old-secret!");
    await user.type(screen.getByLabelText("New password"), "hunter2!42");
    await user.type(screen.getByLabelText("Confirm password"), "hunter2!42");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));

    const putCall = mockFetch.mock.calls.find(([url]) => url === "/api/v1/users/7/password");
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall![1].body)).toEqual({
      password: "hunter2!42",
      currentPassword: "old-secret!",
    });
  });

  test("self-change without the current password is blocked client-side", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));

    const user = userEvent.setup();
    renderChangePassword(7);

    await user.type(await screen.findByLabelText("New password"), "hunter2!42");
    await user.type(screen.getByLabelText("Confirm password"), "hunter2!42");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    expect(await screen.findByText(/current password is required/i)).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/v1/users/7/password")).toBe(false);
  });

  test("self-change with a wrong current password surfaces the 403 as a friendly error", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));
    mockFetch.mockResolvedValueOnce(
      jsonResponse(403, { title: "Forbidden", status: 403, detail: "Current password is missing or incorrect" }),
    );

    const user = userEvent.setup();
    renderChangePassword(7);

    await user.type(await screen.findByLabelText("Current password"), "not-my-password");
    await user.type(screen.getByLabelText("New password"), "hunter2!42");
    await user.type(screen.getByLabelText("Confirm password"), "hunter2!42");
    await user.click(screen.getByRole("button", { name: /^change password$/i }));

    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
    // No navigation happened — the form is still on screen for a retry.
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  });
});
