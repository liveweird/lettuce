import "../test/withPolish";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import { resolveNav } from "../appShell/navModel";
import { hasFeature } from "../api/session";
import i18n from "../i18n";
import { palette } from "../utils/commandPalette";
import CommandPalette from "./CommandPalette";

const USER_ID_KEY = "lettuce.auth.userId";
const ROLES_KEY = "lettuce.auth.roles";
const PANEL_KEY = "lettuce.viewSettings.telemetry.panelOpen";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

/** The palette over the nav the Shell would resolve for the stored session (the same gates, read from storage). */
function renderPalette({ manager = false }: { manager?: boolean } = {}) {
  const admin = (JSON.parse(localStorage.getItem(ROLES_KEY) ?? "[]") as string[]).includes("ADMIN");
  const nav = resolveNav({ isAdmin: admin, isManager: manager, hasFeature }, 7);
  return renderWithProviders(
    <>
      <CommandPalette nav={nav} />
      <Where />
    </>,
  );
}

async function openPalette() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Search or jump to a page…/ }));
  await screen.findByPlaceholderText("Search or jump to a page…");
  return user;
}

describe("CommandPalette", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    localStorage.setItem(USER_ID_KEY, "7");
  });
  afterEach(() => {
    palette.close();
    localStorage.clear();
  });

  test("the wide trigger is named by its visible words; the icon-only trigger by an aria-label; both sit in the tour's anchor", () => {
    const { container } = renderPalette();
    const wide = screen.getByRole("button", { name: /^Search or jump to a page…/ });
    expect(wide).not.toHaveAttribute("aria-label");
    expect(container.querySelector('button[aria-label="Search"]')).not.toBeNull();
    const anchor = container.querySelector('[data-tour="search"]');
    expect(anchor).not.toBeNull();
    expect(anchor).toContainElement(wide);
  });

  test("the trigger opens the palette, and Escape closes it", async () => {
    renderPalette();
    const user = await openPalette();
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByPlaceholderText("Search or jump to a page…")).not.toBeInTheDocument());
  });

  test("Ctrl K opens it from anywhere", async () => {
    renderPalette();
    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", metaKey: true });
    expect(await screen.findByPlaceholderText("Search or jump to a page…")).toBeInTheDocument();
  });

  test("lists the leaves the caller may see, a group's leaves as 'Group › Leaf', and the account destinations", async () => {
    renderPalette();
    await openPalette();
    for (const name of ["Dashboard", "Feedback", "Config › Users", "Dictionaries › Career paths", "Change password", "Changelog", "Notification preferences"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  test("a non-admin does not see the admin leaves or the Actions", async () => {
    renderPalette();
    await openPalette();
    expect(screen.queryByRole("button", { name: "Config › Feature flags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Config › Alerts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /telemetry panel/ })).not.toBeInTheDocument();
  });

  test("a disabled feature's leaf is absent, and the manager-only leaf appears only for managers", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["GOALS"]));
    const { unmount } = renderPalette();
    await openPalette();
    expect(screen.queryByRole("button", { name: "Goals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Succession plans" })).not.toBeInTheDocument();
    unmount();
    palette.close();

    renderPalette({ manager: true });
    await openPalette();
    expect(screen.getByRole("button", { name: "Succession plans" })).toBeInTheDocument();
  });

  test("an admin also gets the admin leaves and the Actions group with the telemetry toggle", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(["ADMIN"]));
    renderPalette();
    const user = await openPalette();
    expect(screen.getByRole("button", { name: "Config › Feature flags" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show the telemetry panel" }));
    expect(localStorage.getItem(PANEL_KEY)).toBe("true");
    await waitFor(() => expect(screen.queryByPlaceholderText("Search or jump to a page…")).not.toBeInTheDocument());
    localStorage.removeItem(PANEL_KEY);
  });

  test("typing filters the list, case-insensitively", async () => {
    renderPalette();
    const user = await openPalette();
    await user.type(screen.getByPlaceholderText("Search or jump to a page…"), "ORG ch");
    expect(screen.getByRole("button", { name: "Config › Org chart" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  test("the search folds diacritics: 'zespoly' finds the Polish 'Zespoły'", async () => {
    await i18n.changeLanguage("pl");
    renderPalette();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Szukaj lub przejdź do strony…/ }));
    await user.type(await screen.findByPlaceholderText("Szukaj lub przejdź do strony…"), "zespoly");
    expect(screen.getByRole("button", { name: /Zespoły/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pulpit" })).not.toBeInTheDocument();
  });

  test("a query with no match says so", async () => {
    renderPalette();
    const user = await openPalette();
    await user.type(screen.getByPlaceholderText("Search or jump to a page…"), "qqqqzzzz");
    expect(await screen.findByText("Nothing found")).toBeInTheDocument();
  });

  test("choosing a result navigates there and closes the palette", async () => {
    renderPalette();
    const user = await openPalette();
    await user.click(screen.getByRole("button", { name: "Notification preferences" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/users/7/notification-preferences");
    await waitFor(() => expect(screen.queryByPlaceholderText("Search or jump to a page…")).not.toBeInTheDocument());
  });
});
