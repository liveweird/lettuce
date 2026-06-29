import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

// The guided tour mounts react-joyride (which measures DOM rects) in the authenticated shell;
// stub it out here so these shell tests don't exercise its layout engine under happy-dom.
vi.mock("react-joyride", () => ({
  Joyride: () => null,
  STATUS: {},
}));

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

function renderApp(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("App shell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
  });

  describe("when authenticated", () => {
    beforeEach(() => {
      localStorage.setItem(TOKEN_KEY, "fake-token");
    });

    test("renders the brand and the dashboard at /", async () => {
      renderApp("/");
      expect(
        await screen.findByRole("heading", { level: 2, name: "Dashboard" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Lettuce")).toBeInTheDocument();
    });

    test("navigating via the navbar swaps the main content", async () => {
      const user = userEvent.setup();
      renderApp("/");
      // Users now lives under the collapsible "Config" group — expand it first.
      await user.click(await screen.findByText("Config"));
      await user.click(await screen.findByRole("link", { name: /^users$/i }));
      expect(
        await screen.findByRole("heading", { level: 2, name: "Users" }),
      ).toBeInTheDocument();
    });

    test("auto-expands the Config group when on one of its routes", async () => {
      // Landing on a Config child route (e.g. the tour navigating in) expands the group without a
      // manual click, so its sibling links are visible.
      renderApp("/users");
      expect(await screen.findByRole("link", { name: /^teams$/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^templates$/i })).toBeInTheDocument();
    });

    test("shows a Change password link pointing at the current user's route", async () => {
      localStorage.setItem(USER_ID_KEY, "7");
      renderApp("/");
      const link = await screen.findByRole("link", { name: /change password/i });
      expect(link).toHaveAttribute("href", "/users/7/change-password");
    });

    test("highlights only the Change password nav item on its route", async () => {
      localStorage.setItem(USER_ID_KEY, "7");
      const user = userEvent.setup();
      renderApp("/users/7/change-password");

      const changeLink = await screen.findByRole("link", { name: /change password/i });
      // Reveal the Users link nested under the collapsed "Config" group.
      await user.click(await screen.findByText("Config"));
      const usersLink = screen.getByRole("link", { name: /^users$/i });
      expect(changeLink).toHaveAttribute("aria-current", "page");
      expect(usersLink).not.toHaveAttribute("aria-current");
    });

    test("shows the logout button", async () => {
      renderApp("/");
      expect(
        await screen.findByRole("button", { name: /logout/i }),
      ).toBeInTheDocument();
    });

    test("shows the signed-in user's name in the header", async () => {
      localStorage.setItem(USER_ID_KEY, "7");
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 7, name: "Alice", email: "alice@example.com", role: "USER" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      renderApp("/");

      expect(await screen.findByText("Alice")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/users/7",
        expect.any(Object),
      );
    });
  });

  describe("when not authenticated", () => {
    test("redirects from / to the login screen", async () => {
      renderApp("/");
      expect(
        await screen.findByRole("heading", { level: 3, name: /sign in/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 3, name: "Users in my teams" }),
      ).not.toBeInTheDocument();
    });

    test("redirects from a protected route to the login screen", async () => {
      renderApp("/teams");
      expect(
        await screen.findByRole("heading", { level: 3, name: /sign in/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 2, name: "Teams" }),
      ).not.toBeInTheDocument();
    });
  });
});
