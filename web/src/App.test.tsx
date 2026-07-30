import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { APP_VERSION } from "./changelog/entries";

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
    <MantineProvider env="test">
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

    test("the Config group toggle is a keyboard-focusable button", async () => {
      const user = userEvent.setup();
      renderApp("/");
      const toggle = await screen.findByRole("button", { name: /config/i });
      toggle.focus();
      expect(toggle).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(await screen.findByRole("link", { name: /^users$/i })).toBeInTheDocument();
    });

    test("renders a skip-to-content link targeting the main area", async () => {
      renderApp("/");
      const skip = await screen.findByRole("link", { name: /skip to main content/i });
      expect(skip).toHaveAttribute("href", "#main-content");
      expect(document.querySelector("main#main-content")).not.toBeNull();
    });

    test("shows a Changelog nav link and a linked version stamp with the what's-new dot", async () => {
      renderApp("/");
      const navLink = await screen.findByRole("link", { name: /^changelog$/i });
      expect(navLink).toHaveAttribute("href", "/changelog");
      // The version stamp itself is the second affordance for the same route.
      expect(screen.getByTitle("Build version")).toHaveAttribute("href", "/changelog");
      // Nothing seen yet in this fresh storage → the dot (carrying the accessible title) shows.
      expect(screen.getByTitle("What's new")).toBeInTheDocument();
    });

    test("opening the changelog clears the what's-new dot immediately", async () => {
      const user = userEvent.setup();
      renderApp("/");
      await screen.findByTitle("What's new");
      await user.click(screen.getByRole("link", { name: /^changelog$/i }));
      expect(
        await screen.findByRole("heading", { level: 2, name: "Changelog" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByTitle("What's new")).not.toBeInTheDocument(),
      );
      expect(JSON.parse(localStorage.getItem("lettuce.changelog")!)).toEqual({
        seenVersion: APP_VERSION,
      });
    });

    test("shows no dot when the current version was already seen", async () => {
      localStorage.setItem("lettuce.changelog", JSON.stringify({ seenVersion: APP_VERSION }));
      renderApp("/");
      await screen.findByTitle("Build version");
      expect(screen.queryByTitle("What's new")).not.toBeInTheDocument();
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
      // Route by URL: the shell now also fetches the visible alerts, so a single
      // mockResolvedValueOnce would be consumed by whichever query fires first.
      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/v1/users/7") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: 7, name: "Alice", email: "alice@example.com", role: "USER" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      renderApp("/");

      expect(await screen.findByText("Alice")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/users/7",
        expect.any(Object),
      );
      // The header renders the app-wide initials avatar (PersonaChip convention),
      // not a static glyph — Mantine derives "AL" from the single-word name.
      const header = screen.getByRole("banner");
      expect(header.querySelector(".mantine-Avatar-root")).not.toBeNull();
      expect(within(header).getByText("AL")).toBeInTheDocument();
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
