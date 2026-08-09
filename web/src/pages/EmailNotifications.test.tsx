import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import EmailNotifications from "./EmailNotifications";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLES_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderPage(id: number | string = 7) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/users/${id}/email-notifications`]}>
          <Routes>
            <Route path="/users/:id/email-notifications" element={<EmailNotifications />} />
            <Route path="/users" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
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
  disabledFeatures: [] as string[],
  emailNotificationsEnabled: true,
};

describe("EmailNotifications page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLES_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
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

  test("renders the switch seeded from the loaded setting", async () => {
    mockApi();
    renderPage(7);
    const toggle = (await screen.findByRole("switch", {
      name: "Send me an email for every notification",
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  test("an opted-out user sees the switch off", async () => {
    mockApi({ user: { ...EXISTING_USER, emailNotificationsEnabled: false } });
    renderPage(7);
    const toggle = (await screen.findByRole("switch", {
      name: "Send me an email for every notification",
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  test("toggling off and saving PUTs the setting, toasts, and returns home", async () => {
    mockApi();
    const showSpy = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderPage(7);

    await user.click(
      await screen.findByRole("switch", { name: "Send me an email for every notification" }),
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const putCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall![0]).toBe("/api/v1/users/7/email-notifications");
    expect(JSON.parse((putCall![1] as { body: string }).body)).toEqual({ enabled: false });
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Email notification settings saved" }),
    );
  });

  test("a failing save shows an inline error and stays on the page", async () => {
    mockApi({ putStatus: 500 });
    const user = userEvent.setup();
    renderPage(7);

    await user.click(
      await screen.findByRole("switch", { name: "Send me an email for every notification" }),
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Saving failed (status 500)")).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("a 404 user shows the not-found state", async () => {
    mockApi({ userStatus: 404 });
    renderPage(7);
    expect(await screen.findByText("User not found")).toBeInTheDocument();
  });

  test("an admin opening another user's page sees their identity line", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(["ADMIN"]));
    localStorage.setItem(USER_ID_KEY, "1");
    mockApi();
    renderPage(7);
    expect(await screen.findByText("Alice (alice@example.com)")).toBeInTheDocument();
  });

  test("a non-admin opening another user's page is redirected home", () => {
    localStorage.setItem(USER_ID_KEY, "1");
    mockApi();
    renderPage(7);
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
  });
});
