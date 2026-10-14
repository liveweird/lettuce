import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Button, Menu } from "@mantine/core";
import { fireEvent, renderWithProviders, screen } from "../test/render";
import { TourContext } from "./tourSupport";
import TutorialsSubmenu from "./TutorialsSubmenu";

const isManager = vi.hoisted(() => ({ value: false }));
vi.mock("../hooks/useIsManager", () => ({ useIsManager: () => isManager.value }));

const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

function renderSubmenu() {
  const startTour = vi.fn();
  const launchTutorial = vi.fn();
  renderWithProviders(
    <TourContext.Provider value={{ startTour, startTutorial: () => {}, launchTutorial }}>
      <Menu>
        <Menu.Target>
          <Button>User menu</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <TutorialsSubmenu />
        </Menu.Dropdown>
      </Menu>
    </TourContext.Provider>,
  );
  return { startTour, launchTutorial };
}

async function openSubmenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "User menu" }));
  await user.click(await screen.findByRole("menuitem", { name: "Tutorials" }));
  await screen.findByRole("menuitem", { name: "Quick app tour" });
  return user;
}

// Every tutorial's launch label, in navbar order — the submenu reads them from tutorials.json.
const ALL = [
  "How feedback works",
  "How 1:1 meetings work",
  "How goals work",
  "How the impact log works",
  "How days off work",
  "How team KPIs work",
  "How performance reviews work",
  "How pulse surveys work",
  "How succession plans work",
];

const tutorialItems = () =>
  screen
    .getAllByRole("menuitem")
    .map((el) => el.textContent ?? "")
    .filter((text) => text.startsWith("How "));

describe("TutorialsSubmenu", () => {
  beforeEach(() => {
    localStorage.clear();
    isManager.value = false;
  });
  afterEach(() => localStorage.clear());

  test("a manager sees the app tour and all nine tutorials, in navbar order", async () => {
    isManager.value = true;
    renderSubmenu();
    await openSubmenu();
    expect(tutorialItems()).toEqual(ALL);
  });

  test("someone who manages nobody gets no succession tutorial, like the nav", async () => {
    renderSubmenu();
    await openSubmenu();
    expect(tutorialItems()).toEqual(ALL.filter((label) => label !== "How succession plans work"));
  });

  test("a disabled feature hides its tutorial", async () => {
    isManager.value = true;
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["GOALS", "PULSE_SURVEYS"]));
    renderSubmenu();
    await openSubmenu();
    expect(tutorialItems()).toEqual(
      ALL.filter((label) => label !== "How goals work" && label !== "How pulse surveys work"),
    );
  });

  test("picking a tutorial launches it; picking the app tour starts the whirlwind", async () => {
    const { startTour, launchTutorial } = renderSubmenu();
    // fireEvent, not userEvent: under happy-dom a userEvent click on a submenu item never reaches
    // its onClick (the hover-driven submenu reacts to userEvent's full pointer sequence); fireEvent
    // dispatches the click alone. The real-browser click path is the e2e spec's job.
    await openSubmenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "How days off work" }));
    expect(launchTutorial).toHaveBeenCalledWith("daysOff");

    await openSubmenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Quick app tour" }));
    expect(startTour).toHaveBeenCalledTimes(1);
  });

  describe("on a phone (below the sm breakpoint, v4.18.1)", () => {
    const originalMatchMedia = window.matchMedia;
    beforeEach(() => {
      const narrow = window.matchMedia;
      window.matchMedia = (query: string) =>
        query.includes("min-width")
          ? ({
              matches: false,
              media: query,
              onchange: null,
              addListener: () => {},
              removeListener: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            } as unknown as MediaQueryList)
          : narrow(query);
    });
    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    test("the entries render inline under a Tutorials label, with no flyout", async () => {
      isManager.value = true;
      renderSubmenu();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "User menu" }));
      await screen.findByRole("menuitem", { name: "Quick app tour" });
      expect(screen.getByText("Tutorials")).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Tutorials" })).not.toBeInTheDocument();
      expect(tutorialItems()).toEqual(ALL);
    });

    test("tapping an inline entry launches it", async () => {
      const { startTour, launchTutorial } = renderSubmenu();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "User menu" }));
      await user.click(await screen.findByRole("menuitem", { name: "How goals work" }));
      expect(launchTutorial).toHaveBeenCalledWith("goals");
      await user.click(screen.getByRole("button", { name: "User menu" }));
      await user.click(await screen.findByRole("menuitem", { name: "Quick app tour" }));
      expect(startTour).toHaveBeenCalledTimes(1);
    });
  });
});
