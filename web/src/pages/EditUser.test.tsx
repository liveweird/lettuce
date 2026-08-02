import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

type Entry = { id: number; value: string };

const EXISTING_USER = {
  id: 7,
  name: "Alice",
  email: "alice@example.com",
  roles: [] as string[],
  careerPath: null as Entry | null,
  careerSpecialization: null as Entry | null,
  seniorityLevel: null as Entry | null,
};

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

  // URL-routed mock: the page fetches the user AND the three dictionaries concurrently,
  // so sequential mockResolvedValueOnce chains would race.
  function mockApi({
    user = EXISTING_USER,
    userStatus = 200,
    putStatus = 204,
    dictionaries = {},
  }: {
    user?: typeof EXISTING_USER;
    userStatus?: number;
    putStatus?: number;
    dictionaries?: Record<string, Entry[]>;
  } = {}) {
    mockFetch.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.startsWith("/api/v1/dictionaries/")) {
        const slug = url.split("/").pop()!;
        return Promise.resolve(jsonResponse(200, { items: dictionaries[slug] ?? [] }));
      }
      if (method === "PUT") {
        return Promise.resolve(
          putStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putStatus, { error: "err", message: "err" }),
        );
      }
      if (method === "GET") {
        return Promise.resolve(
          userStatus === 200 ? jsonResponse(200, user) : jsonResponse(userStatus, { error: "not_found", message: "missing" }),
        );
      }
      return Promise.resolve(jsonResponse(500, {}));
    });
  }

  function putBody(): Record<string, unknown> {
    const putCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall).toBeDefined();
    return JSON.parse((putCall![1] as { body: string }).body);
  }

  test("pre-fills form from GET and PUTs edits then redirects to /users", async () => {
    mockApi();

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

    const putCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall![0]).toBe("/api/v1/users/7");
    // Unset career fields are OMITTED (leave-unchanged) — the body carries no extra keys.
    expect(putBody()).toEqual({
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
    mockApi({ putStatus: 409 });

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
    mockApi({ userStatus: 404 });

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
    mockApi({ user: { ...EXISTING_USER, roles: ["ADMIN"] } });

    const user = userEvent.setup();
    renderEditUser(7);

    await screen.findByDisplayValue("Alice");
    // The selected role renders as a pill whose remove button is accessibly named (v1.24.1).
    expect(screen.getByRole("button", { name: "Remove role Admin" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    expect(putBody().roles).toEqual(["ADMIN"]);
  });

  test("non-numeric id in URL redirects to /users without fetching", () => {
    renderEditUser("abc");
    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("client-side validation blocks an empty submission", async () => {
    mockApi();

    const user = userEvent.setup();
    renderEditUser(7);

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("Alice"));
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    await user.clear(nameInput);
    await user.clear(emailInput);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/name must be 1–50 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    const putCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall).toBeUndefined();
  });

  test("career pickers prefill from the user and picked values are PUT as numeric ids", async () => {
    mockApi({
      user: { ...EXISTING_USER, careerPath: { id: 11, value: "Software Engineer" } },
      dictionaries: {
        "career-paths": [
          { id: 11, value: "Software Engineer" },
          { id: 12, value: "System Analyst" },
        ],
        "seniority-levels": [
          { id: 31, value: "Junior" },
          { id: 32, value: "Senior" },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditUser(7);

    const careerPathInput = (await screen.findByLabelText("Career path", {
      selector: "input",
    })) as HTMLInputElement;
    await waitFor(() => expect(careerPathInput.value).toBe("Software Engineer"));

    const seniorityInput = screen.getByLabelText("Seniority level", { selector: "input" });
    await waitFor(() => expect(seniorityInput).not.toBeDisabled());
    fireEvent.click(seniorityInput); // open the searchable combobox
    await user.click(await screen.findByText("Senior"));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    const body = putBody();
    expect(body.careerPathId).toBe(11); // resubmitting the current value is fine
    expect(body.seniorityLevelId).toBe(32);
    expect(body).not.toHaveProperty("careerSpecializationId"); // still unset → omitted
  });

  test("a soft-deleted current entry still displays in its picker", async () => {
    mockApi({
      user: { ...EXISTING_USER, careerPath: { id: 99, value: "Retired Path" } },
      dictionaries: {
        "career-paths": [{ id: 11, value: "Software Engineer" }], // 99 no longer active
      },
    });

    renderEditUser(7);

    const careerPathInput = (await screen.findByLabelText("Career path", {
      selector: "input",
    })) as HTMLInputElement;
    await waitFor(() => expect(careerPathInput.value).toBe("Retired Path"));
  });

  test("unset career fields show the orange missing hint", async () => {
    mockApi({
      user: { ...EXISTING_USER, careerPath: { id: 11, value: "Software Engineer" } },
      dictionaries: { "career-paths": [{ id: 11, value: "Software Engineer" }] },
    });

    renderEditUser(7);

    await screen.findByDisplayValue("Alice");
    // Two of the three fields are unset — exactly two hints.
    await waitFor(() =>
      expect(screen.getAllByText("Missing — providing it is strongly advised")).toHaveLength(2),
    );
  });
});
