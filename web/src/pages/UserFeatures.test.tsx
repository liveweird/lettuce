import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import UserFeatures from "./UserFeatures";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderUserFeatures(id: number | string = 7) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/users/${id}/features`]}>
          <Routes>
            <Route path="/users/:id/features" element={<UserFeatures />} />
            <Route path="/users" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const EXISTING_USER = {
  id: 7,
  name: "Alice",
  email: "alice@example.com",
  roles: [] as string[],
  disabledFeatures: ["GOALS", "DAYS_OFF"] as string[],
};

describe("UserFeatures page", () => {
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

  function mockApi({
    user = EXISTING_USER,
    userStatus = 200,
    putStatus = 204,
  }: { user?: typeof EXISTING_USER; userStatus?: number; putStatus?: number } = {}) {
    mockFetch.mockImplementation((_input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        return Promise.resolve(
          putStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putStatus, { title: "err", status: putStatus }),
        );
      }
      return Promise.resolve(
        userStatus === 200
          ? jsonResponse(200, user)
          : jsonResponse(userStatus, { title: "not found", status: userStatus }),
      );
    });
  }

  function putBody(): Record<string, unknown> {
    const putCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall).toBeDefined();
    return JSON.parse((putCall![1] as { body: string }).body);
  }

  test("renders six switches seeded from the user's disabled set", async () => {
    mockApi();
    renderUserFeatures(7);

    const feedbacks = (await screen.findByRole("switch", { name: "Feedbacks" })) as HTMLInputElement;
    expect(feedbacks.checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Goals" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Days Off" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "1:1 Meetings" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Team KPIs" }) as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole("switch", { name: "Performance Reviews" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("toggling and saving PUTs the wholesale disabled set, toasts, and returns to /users", async () => {
    mockApi();
    const showSpy = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderUserFeatures(7);

    // Re-enable Goals, disable Feedbacks → the new disabled set is FEEDBACKS + DAYS_OFF.
    await user.click(await screen.findByRole("switch", { name: "Goals" }));
    await user.click(screen.getByRole("switch", { name: "Feedbacks" }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    const putCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall![0]).toBe("/api/v1/users/7/features");
    expect(putBody()).toEqual({ disabledFeatures: ["FEEDBACKS", "DAYS_OFF"] });
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Features saved" }),
    );
  });

  test("a failing save shows an inline error and stays on the page", async () => {
    mockApi({ putStatus: 403 });
    const user = userEvent.setup();
    renderUserFeatures(7);

    await user.click(await screen.findByRole("switch", { name: "Feedbacks" }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText("You don't have permission to change this user's features."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("a 404 user shows the not-found state", async () => {
    mockApi({ userStatus: 404 });
    renderUserFeatures(7);
    expect(await screen.findByText("User not found.")).toBeInTheDocument();
  });

  test("a non-admin is redirected to /users", () => {
    localStorage.setItem(ROLE_KEY, "[]");
    mockApi();
    renderUserFeatures(7);
    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
  });
});
