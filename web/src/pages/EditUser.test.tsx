import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditUser from "./EditUser";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderEditUser(id: number | string = 7) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/users/${id}/edit`]}>
          <Routes>
            <Route path="/users/:id/edit" element={<EditUser />} />
            <Route path="/users" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}


const EXISTING_USER = { id: 7, name: "Alice", email: "alice@example.com", roles: [] as const };

describe("EditUser page", () => {
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

  test("pre-fills form from GET and PUTs edits then redirects to /users", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const user = userEvent.setup();
    renderEditUser(7);

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("Alice"));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "alice@example.com",
    );

    await user.clear(nameInput);
    await user.type(nameInput, "Alicia");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));

    const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(putCall![0]).toBe("/api/v1/users/7");
    expect(JSON.parse(putCall![1].body)).toEqual({
      name: "Alicia",
      email: "alice@example.com",
      roles: [],
    });
  });

  test("non-admin is redirected to /users without fetching", () => {
    localStorage.setItem(ROLE_KEY, "[]");
    renderEditUser(7);
    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("409 on PUT surfaces an email-field error and keeps the form", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));
    mockFetch.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", message: "Email taken" }),
    );

    const user = userEvent.setup();
    renderEditUser(7);

    await screen.findByDisplayValue("Alice");
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, "taken@example.com");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/email already in use/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("404 on GET shows a 'User not found' alert", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(404, { error: "not_found", message: "missing" }),
    );

    renderEditUser(999);

    expect(await screen.findByText(/user not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  test("submitted PUT body includes the roles field", async () => {
    // The "pre-fills + PUTs" test above already verifies that the roles round-trip
    // from GET into the PUT body. We don't drive the Mantine MultiSelect widget directly
    // because its open-on-click behavior is unreliable under happy-dom. The
    // positive admin-roles-change path is covered by the backend
    // `PUT users id lets admin change another user's role` test.
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ...EXISTING_USER, roles: ["ADMIN"] }));
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const user = userEvent.setup();
    renderEditUser(7);

    await screen.findByDisplayValue("Alice");
    // The selected role renders as a pill whose remove button is accessibly named (v1.24.1).
    expect(screen.getByRole("button", { name: "Remove role Admin" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(putCall![1].body).roles).toEqual(["ADMIN"]);
  });

  test("non-numeric id in URL redirects to /users without fetching", () => {
    renderEditUser("abc");
    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("client-side validation blocks an empty submission", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, EXISTING_USER));

    const user = userEvent.setup();
    renderEditUser(7);

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement;
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    await user.clear(nameInput);
    await user.clear(emailInput);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/name must be 1–50 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeUndefined();
  });
});
