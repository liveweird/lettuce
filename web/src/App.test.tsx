import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { APP_VERSION } from "./changelog/version";

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

    test("an unmatched URL renders the not-found page inside the shell", async () => {
      renderApp("/definitely/not-a-page");
      expect(
        await screen.findByRole("heading", { level: 2, name: "Page not found" }),
      ).toBeInTheDocument();
      // The Shell mounted around it — before v2.22.0 an unmatched URL rendered nothing at all.
      expect(screen.getByText("Lettuce")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/");
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
      expect(screen.getByRole("link", { name: /^feedback templates$/i })).toBeInTheDocument();
    });

    test("Review periods is a Config leaf for everyone; Alerts stays admin-only", async () => {
      // No roles in localStorage = a regular user (the Dictionaries-group precedent).
      const user = userEvent.setup();
      renderApp("/");
      await user.click(await screen.findByText("Config"));
      expect(screen.getByRole("link", { name: /^review periods$/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^alerts$/i })).toBeNull();
    });

    test("Days off is a top-level nav leaf and Public holidays a Config leaf for everyone", async () => {
      const user = userEvent.setup();
      renderApp("/");
      expect(await screen.findByRole("link", { name: /^days off$/i })).toHaveAttribute(
        "href",
        "/days-off",
      );
      await user.click(await screen.findByText("Config"));
      expect(screen.getByRole("link", { name: /^public holidays$/i })).toHaveAttribute(
        "href",
        "/public-holidays",
      );
    });

    test("an admin's Config group additionally lists Alerts", async () => {
      localStorage.setItem("lettuce.auth.roles", JSON.stringify(["ADMIN"]));
      try {
        const user = userEvent.setup();
        renderApp("/");
        await user.click(await screen.findByText("Config"));
        expect(screen.getByRole("link", { name: /^review periods$/i })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /^alerts$/i })).toBeInTheDocument();
      } finally {
        localStorage.removeItem("lettuce.auth.roles");
      }
    });

    test("a disabled GOALS feature drops the Goals nav leaf; other leaves stay", async () => {
      localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["GOALS"]));
      try {
        renderApp("/");
        expect(await screen.findByRole("link", { name: /^feedback$/i })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /^days off$/i })).toBeInTheDocument();
        // The Impact log leaf (v2.36.0) rides its own flag — untouched by GOALS.
        expect(screen.getByRole("link", { name: /^impact log$/i })).toHaveAttribute(
          "href",
          "/impact-log",
        );
        expect(screen.queryByRole("link", { name: /^goals$/i })).toBeNull();
      } finally {
        localStorage.removeItem("lettuce.auth.disabledFeatures");
      }
    });

    test("the Succession plans nav leaf is manager-only (async gate) and rides its feature flag", async () => {
      // The bare fetch stub answers nothing, so the managed-teams probe never resolves to a
      // manager — the leaf must stay absent.
      renderApp("/");
      expect(await screen.findByRole("link", { name: /^feedback$/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^succession plans$/i })).toBeNull();
      cleanup();

      // A manager (the /teams?managerId probe answers total > 0) gets the leaf…
      localStorage.setItem(USER_ID_KEY, "7");
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (String(url).startsWith("/api/v1/teams?")) {
            return Promise.resolve(
              new Response(JSON.stringify({ items: [], page: 1, pageSize: 1, total: 1 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
          return new Promise<Response>(() => {});
        }),
      );
      renderApp("/");
      expect(await screen.findByRole("link", { name: /^succession plans$/i })).toHaveAttribute(
        "href",
        "/succession",
      );
      cleanup();

      // …unless the SUCCESSION_PLANS flag is disabled.
      localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["SUCCESSION_PLANS"]));
      try {
        renderApp("/");
        expect(await screen.findByRole("link", { name: /^feedback$/i })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /^succession plans$/i })).toBeNull();
      } finally {
        localStorage.removeItem("lettuce.auth.disabledFeatures");
      }
    });

    test("a disabled IMPACT_LOG feature drops the Impact log nav leaf", async () => {
      localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["IMPACT_LOG"]));
      try {
        renderApp("/");
        expect(await screen.findByRole("link", { name: /^goals$/i })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /^impact log$/i })).toBeNull();
      } finally {
        localStorage.removeItem("lettuce.auth.disabledFeatures");
      }
    });

    test("disabling FEEDBACKS, PERFORMANCE_REVIEWS, and DAYS_OFF hides their nav and Config leaves", async () => {
      localStorage.setItem(USER_ID_KEY, "7");
      localStorage.setItem(
        "lettuce.auth.disabledFeatures",
        JSON.stringify(["FEEDBACKS", "PERFORMANCE_REVIEWS", "DAYS_OFF"]),
      );
      try {
        const user = userEvent.setup();
        renderApp("/");
        // The surviving top-level leaves anchor the assertion…
        expect(await screen.findByRole("link", { name: /^dashboard$/i })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /^team kpis$/i })).toBeInTheDocument();
        // …the disabled features' top-level + dynamic leaves are gone…
        expect(screen.queryByRole("link", { name: /^feedback$/i })).toBeNull();
        expect(screen.queryByRole("link", { name: /^kudos$/i })).toBeNull();
        expect(screen.queryByRole("link", { name: /^performance$/i })).toBeNull();
        expect(screen.queryByRole("link", { name: /^days off$/i })).toBeNull();
        // …and so are their Config leaves (expand the group so its siblings prove it rendered).
        await user.click(screen.getByText("Config"));
        expect(await screen.findByRole("link", { name: /^users$/i })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /^review periods$/i })).toBeNull();
        expect(screen.queryByRole("link", { name: /^public holidays$/i })).toBeNull();
      } finally {
        localStorage.removeItem("lettuce.auth.disabledFeatures");
      }
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

    test("the Dictionaries group lists all three dictionaries for everyone", async () => {
      // Read access is universal, so the group renders without any role in localStorage.
      const user = userEvent.setup();
      renderApp("/");
      await user.click(await screen.findByText("Dictionaries"));
      expect(await screen.findByRole("link", { name: /^career paths$/i })).toHaveAttribute(
        "href",
        "/dictionaries/career-paths",
      );
      expect(screen.getByRole("link", { name: /^career specializations$/i })).toHaveAttribute(
        "href",
        "/dictionaries/career-specializations",
      );
      expect(screen.getByRole("link", { name: /^seniority levels$/i })).toHaveAttribute(
        "href",
        "/dictionaries/seniority-levels",
      );
    });

    test("auto-expands the Dictionaries group when on one of its routes", async () => {
      renderApp("/dictionaries/seniority-levels");
      expect(await screen.findByRole("link", { name: /^career paths$/i })).toBeInTheDocument();
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
        // The Changelog page is lazy-loaded; under full-suite CPU load the chunk import can
        // exceed findBy's default 1s — the recurring source of this test's flakes.
        await screen.findByRole("heading", { level: 2, name: "Changelog" }, { timeout: 5000 }),
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

    test("the desktop navbar toggle collapses, persists, and restores across remounts", async () => {
      const NAV_KEY = "lettuce.viewSettings.appShell.navCollapsed";
      // The sidebar toggle exposes its state via data-expanded (set while the navbar shows).
      try {
        const user = userEvent.setup();
        const first = renderApp("/");
        const toggle = await screen.findByRole("button", { name: "Show or hide the navigation" });
        // Expanded by default.
        expect(toggle).toHaveAttribute("data-expanded");

        await user.click(toggle);
        expect(toggle).not.toHaveAttribute("data-expanded");
        expect(JSON.parse(localStorage.getItem(NAV_KEY) ?? "null")).toBe(true);

        // A fresh mount (reload) restores the collapsed choice.
        first.unmount();
        renderApp("/");
        const restored = await screen.findByRole("button", { name: "Show or hide the navigation" });
        expect(restored).not.toHaveAttribute("data-expanded");

        await user.click(restored);
        expect(restored).toHaveAttribute("data-expanded");
        expect(JSON.parse(localStorage.getItem(NAV_KEY) ?? "null")).toBe(false);
      } finally {
        // The suite's afterEach only clears the auth keys — don't leak the collapse.
        localStorage.removeItem(NAV_KEY);
      }
    });

    test("the user menu holds Change password and Logout", async () => {
      localStorage.setItem(USER_ID_KEY, "7");
      const user = userEvent.setup();
      renderApp("/");
      // The trigger renders even before (or without) the profile query resolving,
      // so signing out never depends on GET /users/{id} succeeding.
      await user.click(await screen.findByRole("button", { name: "User menu" }));
      const changePassword = await screen.findByRole("menuitem", { name: /change password/i });
      expect(changePassword).toHaveAttribute("href", "/users/7/change-password");
      const emailNotifications = screen.getByRole("menuitem", { name: /email notifications/i });
      expect(emailNotifications).toHaveAttribute("href", "/users/7/email-notifications");
      expect(screen.getByRole("menuitem", { name: /logout/i })).toBeInTheDocument();
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
              JSON.stringify({ id: 7, name: "Alice", email: "alice@example.com", roles: [] }),
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
