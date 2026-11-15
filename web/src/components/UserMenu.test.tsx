import "../test/withPolish";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import { APP_VERSION } from "../changelog/version";
import { jsonResponse } from "../test/http";
import i18n from "../i18n";
import { TourContext } from "./tourSupport";
import UserMenu from "./UserMenu";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";
const ROLES_KEY = "lettuce.auth.roles";
const PANEL_KEY = "lettuce.viewSettings.telemetry.panelOpen";
const SCHEME_KEY = "mantine-color-scheme-value";

const PROFILE = { id: 7, name: "Alice Smith", email: "alice@example.com", roles: [] };

function renderMenu(onLogout = vi.fn()) {
  const startTour = vi.fn();
  const view = renderWithProviders(
    <TourContext.Provider value={{ startTour, startTutorial: () => {}, launchTutorial: () => {} }}>
      <UserMenu onLogout={onLogout} />
    </TourContext.Provider>,
  );
  return { ...view, startTour, onLogout };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /User menu/ }));
  await screen.findByRole("menuitem", { name: "Logout" });
  return user;
}

describe("UserMenu", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, "t");
    localStorage.setItem(USER_ID_KEY, "7");
    // Both seen: no what's-new marker unless a test asks for one.
    localStorage.setItem("lettuce.changelog", JSON.stringify({ seenVersion: APP_VERSION }));
    mockFetch = vi.fn((url: string) =>
      Promise.resolve(url === "/api/v1/users/7" ? jsonResponse(200, PROFILE) : new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    localStorage.clear();
    await i18n.changeLanguage("en");
  });

  test("the trigger shows the name and is named by it plus the hidden 'User menu' words", async () => {
    renderMenu();
    const trigger = await screen.findByRole("button", { name: /Alice Smith/ });
    expect(trigger).toHaveAccessibleName("Alice Smith User menu");
    expect(trigger).toHaveAttribute("data-tour", "user-menu");
  });

  test("the identity block carries the name, the email and a badge per role", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(["ADMIN", "HR"]));
    renderMenu();
    await screen.findByText("Alice Smith");
    await openMenu();
    expect(screen.getAllByText("Alice Smith")).toHaveLength(2);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("HR")).toBeInTheDocument();
  });

  test("a regular user's identity block has no role badges", async () => {
    renderMenu();
    await screen.findByText("Alice Smith");
    await openMenu();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("HR")).not.toBeInTheDocument();
  });

  test("the menu works without the profile: Logout is there and calls onLogout", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, {})));
    const { onLogout } = renderMenu();
    const user = await openMenu();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test("Logout is the destructive item (the AA error-ink class, never Mantine's red)", async () => {
    renderMenu();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Logout" }).className).toMatch(/menuItemDestructive/);
  });

  test("the language items list every language by native name and mark the current one with aria-current", async () => {
    renderMenu();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "English" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: "Polski" })).not.toHaveAttribute("aria-current");
  });

  test("picking a language switches the UI, saves it to the server and moves the mark", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /User menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Polski" }));

    await waitFor(() => expect(i18n.resolvedLanguage).toBe("pl"));
    const put = mockFetch.mock.calls.find(([url]) => String(url).includes("/language")) as [string, RequestInit];
    expect(put[0]).toBe("/api/v1/users/7/language");
    expect(put[1].method).toBe("PUT");
    expect(JSON.parse(String(put[1].body))).toEqual({ language: "pl" });

    // The language item closes the menu; reopened (now in Polish), the mark sits on Polski.
    await user.click(screen.getByRole("button", { name: /Menu użytkownika/ }));
    expect(await screen.findByRole("menuitem", { name: "Polski" })).toHaveAttribute("aria-current", "true");
  });

  test("without a session user id no server save is attempted", async () => {
    localStorage.removeItem(USER_ID_KEY);
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /User menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Polski" }));
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("pl"));
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/language"))).toBe(false);
  });

  test("the theme items set the colour scheme, carry aria-current and leave the menu open", async () => {
    renderMenu();
    const user = await openMenu();
    const light = screen.getByRole("menuitem", { name: "Light" });
    const dark = screen.getByRole("menuitem", { name: "Dark" });
    const system = screen.getByRole("menuitem", { name: "System" });
    expect(light).toHaveAttribute("aria-current", "true");

    await user.click(dark);
    expect(localStorage.getItem(SCHEME_KEY)).toBe("dark");
    expect(screen.getByRole("menuitem", { name: "Dark" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: "Light" })).not.toHaveAttribute("aria-current");
    // Still open: the other items are reachable without reopening.
    expect(screen.getByRole("menuitem", { name: "Logout" })).toBeInTheDocument();

    await user.click(system);
    expect(localStorage.getItem(SCHEME_KEY)).toBe("auto");
    expect(screen.getByRole("menuitem", { name: "System" })).toHaveAttribute("aria-current", "true");
    // No radiogroup inside role=menu (axe aria-required-children).
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  test("lists the account destinations: Change password, Notification preferences, Tutorials, Replay the tour, Changelog", async () => {
    renderMenu();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Change password" })).toHaveAttribute("href", "/users/7/change-password");
    expect(screen.getByRole("menuitem", { name: "Notification preferences" })).toHaveAttribute(
      "href",
      "/users/7/notification-preferences",
    );
    expect(screen.getByRole("menuitem", { name: "Tutorials" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Replay the tour" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
  });

  test("'Replay the tour' starts the tour", async () => {
    const { startTour } = renderMenu();
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Replay the tour" }));
    expect(startTour).toHaveBeenCalledTimes(1);
  });

  test("an unseen release shows the dot on the trigger and a New badge on the Changelog item; a seen one shows neither", async () => {
    localStorage.removeItem("lettuce.changelog");
    const { container, unmount } = renderMenu();
    expect(container.querySelector(".mantine-Indicator-indicator")).not.toBeNull();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /Changelog/ })).toHaveTextContent("New");
    unmount();

    localStorage.setItem("lettuce.changelog", JSON.stringify({ seenVersion: APP_VERSION }));
    const seen = renderMenu();
    expect(seen.container.querySelector(".mantine-Indicator-indicator")).toBeNull();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Changelog" })).not.toHaveTextContent("New");
  });

  test("the dot carries no title: the navbar's version stamp owns the accessible 'What's new' name", () => {
    localStorage.removeItem("lettuce.changelog");
    renderMenu();
    expect(screen.queryByTitle("What's new")).not.toBeInTheDocument();
  });

  describe("the telemetry toggle", () => {
    afterEach(() => localStorage.removeItem(PANEL_KEY));

    test("is absent for a regular user", async () => {
      renderMenu();
      await openMenu();
      expect(screen.queryByRole("menuitem", { name: "Telemetry panel" })).not.toBeInTheDocument();
    });

    test("for an ADMIN it toggles the stored flag and says it is on with aria-current", async () => {
      localStorage.setItem(ROLES_KEY, JSON.stringify(["ADMIN"]));
      const user = userEvent.setup();
      renderMenu();
      await user.click(screen.getByRole("button", { name: /User menu/ }));
      const item = await screen.findByRole("menuitem", { name: "Telemetry panel" });
      expect(item).not.toHaveAttribute("aria-current");
      await user.click(item);
      expect(localStorage.getItem(PANEL_KEY)).toBe("true");

      await user.click(screen.getByRole("button", { name: /User menu/ }));
      expect(await screen.findByRole("menuitem", { name: "Telemetry panel" })).toHaveAttribute("aria-current", "true");
    });
  });

  test("Tab leaves the open menu and hands the focus to the trigger", async () => {
    renderMenu();
    await openMenu();
    const trigger = screen.getByRole("button", { name: /User menu/ });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "English" }), { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Logout" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
