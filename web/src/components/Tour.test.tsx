import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider, useBlocker, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { theme } from "../theme";

// Stub react-joyride (it measures DOM rects under a real browser) and capture the props it receives.
// While the tour is running we render the supplied custom `tooltipComponent` with minimal fake
// render props, so tests can drive Pause/Abandon through the real provider wiring; otherwise null.
const joyrideSpy = vi.hoisted(() => vi.fn());
vi.mock("react-joyride", async () => {
  const React = await import("react");
  const btn = (action: string) => ({
    "aria-label": action,
    "data-action": action,
    role: "button",
    title: action,
    onClick: () => {},
  });
  return {
    Joyride: (props: Record<string, unknown>) => {
      joyrideSpy(props);
      const Tooltip = props.tooltipComponent;
      if (!props.run || !Tooltip) return null;
      return React.createElement(Tooltip as never, {
        step: { title: "Step 1 of 1", content: "tour body" },
        index: 0,
        isLastStep: false,
        size: 1,
        continuous: true,
        backProps: btn("back"),
        primaryProps: btn("primary"),
        closeProps: btn("close"),
        skipProps: btn("skip"),
        tooltipProps: { "aria-modal": true, role: "dialog" },
        controls: { close: () => {}, info: () => ({}) },
      });
    },
    STATUS: { FINISHED: "finished", SKIPPED: "skipped", RUNNING: "running" },
  };
});

import { TourProvider, TourTooltip } from "./Tour";
import {
  TourActionsContext,
  useTour,
  buildSteps,
  hasSeenTour,
  waitForElement,
  TOUR_STEPS,
  type TourStepDef,
} from "./tourSupport";
import { renderWithProviders } from "../test/render";

const USER_ID_KEY = "lettuce.auth.userId";
const ROLE_KEY = "lettuce.auth.roles";

// A minimal def list exercising every gate/navTo `buildSteps` still supports generically (the
// per-feature tutorials use them) even though no `TOUR_STEPS` def carries `navTo` since v3.23.0.
const SYNTHETIC_DEFS: TourStepDef[] = [
  { target: "body", contentKey: "tour.steps.welcome", placement: "center" },
  { target: '[data-tour="synthetic-admin"]', contentKey: "tour.steps.welcome", placement: "right", adminOnly: true },
  {
    target: '[data-tour="synthetic-manager-or-hr"]',
    contentKey: "tour.steps.welcome",
    placement: "right",
    managerOrHr: true,
  },
  {
    target: '[data-tour="synthetic-manager-only"]',
    contentKey: "tour.steps.welcome",
    placement: "right",
    managerOnly: true,
  },
];

// A def list exercising navTo resolution (static + `:userId`) — the whirlwind carries none of
// these anymore, but the generic builder still resolves them for the tutorials.
const NAVIGATING_SYNTHETIC_DEFS: TourStepDef[] = [
  { target: "body", contentKey: "tour.steps.welcome", placement: "center" },
  {
    target: '[data-tour="synthetic-static"]',
    contentKey: "tour.steps.welcome",
    placement: "right",
    navTo: "/kudos",
  },
  {
    target: '[data-tour="synthetic-userid"]',
    contentKey: "tour.steps.welcome",
    placement: "right",
    navTo: "/users/:userId/change-password",
  },
];

type JoyrideProps = {
  run: boolean;
  steps: { target: string }[];
  onEvent: (data: unknown, controls: { info: () => { status: string } }) => void;
};
const lastProps = () => joyrideSpy.mock.calls.at(-1)![0] as JoyrideProps;
const controlsWithStatus = (status: string) => ({ info: () => ({ status }) });

function Replayer() {
  const { startTour } = useTour();
  return <button onClick={startTour}>replay</button>;
}

// Starts the feedback tutorial — the only tutorial registered today, so it stands in for
// "any tutorial" below.
function TutorialStarter() {
  const { startTutorial } = useTour();
  return <button onClick={() => startTutorial("feedbacks")}>start-tutorial</button>;
}

// The account menu's launcher (v4.4.0) — starts a tutorial from wherever the caller is.
function TutorialLauncher() {
  const { launchTutorial } = useTour();
  return <button onClick={() => launchTutorial("feedbacks")}>launch-tutorial</button>;
}

// A launch whose navigation is overtaken by another one before the home ever shows — the shape a
// discard-guarded launch takes when the user then leaves for some other page.
function OvertakenLauncher() {
  const { launchTutorial } = useTour();
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        launchTutorial("feedbacks");
        navigate("/kudos");
      }}
    >
      launch-then-leave
    </button>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

// TourProvider uses react-router's useNavigate (to switch tabs/routes) and a react-query query
// (to detect managers), so it must render inside both a Router and a QueryClientProvider.
const renderTour = (ui: ReactNode) =>
  render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );

describe("Tour", () => {
  beforeEach(() => {
    joyrideSpy.mockClear();
    localStorage.clear();
    localStorage.setItem(USER_ID_KEY, "7");
    localStorage.setItem(ROLE_KEY, "[]");
    // The manager-detection query resolves to "no managed teams" → isManager false, deterministically.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [], page: 1, pageSize: 1, total: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("buildSteps resolves content through the translator and includes the full menu (22 manager / 21 non-manager)", () => {
    const t = (k: string) => k;
    const manager = buildSteps(TOUR_STEPS, t, true);
    const nonManager = buildSteps(TOUR_STEPS, t, false);

    expect(manager).toHaveLength(22);
    expect(nonManager).toHaveLength(21);
    // Config is present for everyone — it is no longer admin-gated.
    expect(nonManager.some((s) => s.target === '[data-tour="nav-config"]')).toBe(true);
    // Content is resolved through the translator.
    expect(manager[0].content).toBe(TOUR_STEPS[0].contentKey);
  });

  test("buildSteps gates only the Succession step on being a manager", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(TOUR_STEPS, t, false);
    const manager = buildSteps(TOUR_STEPS, t, true);

    expect(nonManager.some((s) => s.target === '[data-tour="nav-succession"]')).toBe(false);
    expect(manager.some((s) => s.target === '[data-tour="nav-succession"]')).toBe(true);
    expect(manager).toHaveLength(nonManager.length + 1);
    // Every other stop (Config included) is for everyone regardless of role.
    for (const target of [
      '[data-tour="nav-dashboard"]',
      '[data-tour="nav-config"]',
      '[data-tour="nav-dictionaries"]',
    ]) {
      expect(nonManager.some((s) => s.target === target), target).toBe(true);
    }
  });

  test("buildSteps still supports adminOnly and managerOrHr gates over a synthetic def list (the tutorials use them)", () => {
    const t = (k: string) => k;

    const plain = buildSteps(SYNTHETIC_DEFS, t, false);
    expect(plain.some((s) => s.target === '[data-tour="synthetic-admin"]')).toBe(false);
    expect(plain.some((s) => s.target === '[data-tour="synthetic-manager-or-hr"]')).toBe(false);
    expect(plain.some((s) => s.target === '[data-tour="synthetic-manager-only"]')).toBe(false);

    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    const admin = buildSteps(SYNTHETIC_DEFS, t, false);
    expect(admin.some((s) => s.target === '[data-tour="synthetic-admin"]')).toBe(true);
    // ADMIN alone doesn't satisfy managerOrHr/managerOnly.
    expect(admin.some((s) => s.target === '[data-tour="synthetic-manager-or-hr"]')).toBe(false);
    expect(admin.some((s) => s.target === '[data-tour="synthetic-manager-only"]')).toBe(false);

    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    const hr = buildSteps(SYNTHETIC_DEFS, t, false);
    // HR alone satisfies managerOrHr but not managerOnly/adminOnly.
    expect(hr.some((s) => s.target === '[data-tour="synthetic-manager-or-hr"]')).toBe(true);
    expect(hr.some((s) => s.target === '[data-tour="synthetic-manager-only"]')).toBe(false);
    expect(hr.some((s) => s.target === '[data-tour="synthetic-admin"]')).toBe(false);

    // A manager (no roles) also satisfies managerOrHr AND managerOnly.
    const manager = buildSteps(SYNTHETIC_DEFS, t, true);
    expect(manager.some((s) => s.target === '[data-tour="synthetic-manager-or-hr"]')).toBe(true);
    expect(manager.some((s) => s.target === '[data-tour="synthetic-manager-only"]')).toBe(true);
  });

  test("buildSteps drops a disabled feature's step (21 manager / 20 non-manager) and renumbers against the shrunk total", () => {
    // A translator that honours interpolation, so we can read the computed current/total.
    const t = (k: string, o?: Record<string, unknown>) => (o ? `${o.current}/${o.total}` : k);

    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["GOALS"]));
    try {
      const manager = buildSteps(TOUR_STEPS, t, true);
      const nonManager = buildSteps(TOUR_STEPS, t, false);

      expect(manager.some((s) => s.target === '[data-tour="nav-my-goals"]')).toBe(false);
      expect(manager).toHaveLength(21);
      expect(nonManager).toHaveLength(20);
      // The "Step X of Y" numbering shrinks with the filtered total.
      const total = manager.length;
      expect(manager[0].title).toBe(`1/${total}`);
      expect(manager[total - 1].title).toBe(`${total}/${total}`);
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("buildSteps with every feature disabled keeps only the 12 non-feature steps", () => {
    localStorage.setItem(
      "lettuce.auth.disabledFeatures",
      JSON.stringify([
        "FEEDBACKS",
        "ONE_ON_ONES",
        "GOALS",
        "IMPACT_LOG",
        "TEAM_KPIS",
        "PERFORMANCE_REVIEWS",
        "DAYS_OFF",
        "PULSE_SURVEYS",
        "SUCCESSION_PLANS",
      ]),
    );
    try {
      // A manager caller too: Succession is additionally feature-tagged, so it stays excluded.
      const steps = buildSteps(TOUR_STEPS, (k) => k, true);

      expect(steps.map((s) => s.target)).toEqual([
        "body",
        '[data-tour="nav-dashboard"]',
        '[data-tour="nav-career"]',
        '[data-tour="nav-config"]',
        '[data-tour="nav-dictionaries"]',
        '[data-tour="nav-change-password"]',
        '[data-tour="nav-changelog"]',
        '[data-tour="notifications"]',
        '[data-tour="language"]',
        '[data-tour="theme"]',
        '[data-tour="user-menu"]',
        '[data-tour="replay"]',
      ]);
      expect(steps).toHaveLength(12);
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("buildSteps numbers each step header as 'Step X of Y' against the filtered total", () => {
    // A translator that honours interpolation, so we can read the computed current/total.
    const t = (k: string, o?: Record<string, unknown>) => (o ? `${o.current}/${o.total}` : k);

    const steps = buildSteps(TOUR_STEPS, t, false);
    const total = steps.length;
    expect(steps[0].title).toBe(`1/${total}`);
    expect(steps[total - 1].title).toBe(`${total}/${total}`);
  });

  test("no whirlwind step navigates — TOUR_STEPS carries no navTo (v3.23.0)", () => {
    expect(TOUR_STEPS.every((s) => s.navTo === undefined)).toBe(true);
  });

  test("steps with a navTo change the view via their before hook before showing (generic builder, synthetic defs)", async () => {
    const t = (k: string) => k;
    const navigateTo = vi.fn(() => Promise.resolve());
    const steps = buildSteps(NAVIGATING_SYNTHETIC_DEFS, t, true, navigateTo, 7);

    const staticStep = steps.find((s) => s.target === '[data-tour="synthetic-static"]');
    await staticStep!.before!({} as never);
    expect(navigateTo).toHaveBeenCalledWith("/kudos", '[data-tour="synthetic-static"]');

    const userIdStep = steps.find((s) => s.target === '[data-tour="synthetic-userid"]');
    await userIdStep!.before!({} as never);
    expect(navigateTo).toHaveBeenCalledWith(
      "/users/7/change-password",
      '[data-tour="synthetic-userid"]',
    );

    // A step without navTo (the welcome step) still has a before hook (it pins the scroll to
    // the top) but never navigates.
    navigateTo.mockClear();
    const welcome = steps.find((s) => s.target === "body");
    await welcome!.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test("a :userId navTo degrades to not navigating when the caller id is unknown (synthetic defs)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const steps = buildSteps(NAVIGATING_SYNTHETIC_DEFS, (k) => k, false, navigateTo, null);

    const userIdStep = steps.find((s) => s.target === '[data-tour="synthetic-userid"]');
    await userIdStep!.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
    // Static navTo steps are unaffected by the missing id.
    const staticStep = steps.find((s) => s.target === '[data-tour="synthetic-static"]');
    await staticStep!.before!({} as never);
    expect(navigateTo).toHaveBeenCalledWith("/kudos", '[data-tour="synthetic-static"]');
  });

  test("every step disables Joyride scrolling and pins the window to the top itself", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      const steps = buildSteps(TOUR_STEPS, (k) => k, true, vi.fn(() => Promise.resolve()));
      // Joyride's own scroll would drag page titles under the fixed header — off on every step.
      expect(steps.every((s) => s.skipScroll === true)).toBe(true);
      for (const step of steps) await step.before!({} as never);
      expect(scrollTo).toHaveBeenCalledTimes(steps.length);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });
    } finally {
      scrollTo.mockRestore();
    }
  });

  test("waitForElement resolves once a matching element appears (cold lazy route)", async () => {
    const el = document.createElement("div");
    el.setAttribute("data-tour", "late-target");
    setTimeout(() => document.body.appendChild(el), 30);

    await waitForElement('[data-tour="late-target"]', 1000);
    expect(document.querySelector('[data-tour="late-target"]')).not.toBeNull();
    el.remove();
  });

  test("waitForElement resolves via the timeout fallback when the element never appears", async () => {
    // timeoutMs 0 → the deadline is already reached, so it resolves immediately without hanging.
    await waitForElement('[data-tour="never-there"]', 0);
    expect(document.querySelector('[data-tour="never-there"]')).toBeNull();
  });

  test("auto-starts once per user, then is suppressed after completion", async () => {
    renderTour(
      <TourProvider>
        <div />
      </TourProvider>,
    );
    // Joyride mounts lazily, so the first props arrive after the chunk resolves.
    await waitFor(() => expect(lastProps().run).toBe(true));
    expect(hasSeenTour(7)).toBe(false);

    // Finishing the tour persists the per-user flag and stops it — with run=false (and no
    // replay yet) the lazy Joyride unmounts, so its running tooltip disappears.
    await act(async () => {
      lastProps().onEvent({}, controlsWithStatus("finished"));
    });
    expect(hasSeenTour(7)).toBe(true);
    expect(screen.queryByText("tour body")).not.toBeInTheDocument();

    // A fresh mount for the same user does not auto-start again — the lazy Joyride (and its
    // react-joyride chunk) is never mounted at all.
    cleanup();
    joyrideSpy.mockClear();
    renderTour(
      <TourProvider>
        <div />
      </TourProvider>,
    );
    await act(async () => {});
    expect(joyrideSpy).not.toHaveBeenCalled();
  });

  test("Replay starts the tour even after it has been seen", async () => {
    localStorage.setItem("lettuce.tour.seen.7", "1");
    renderTour(
      <TourProvider>
        <Replayer />
      </TourProvider>,
    );
    // Already seen → no auto-start; the lazy Joyride is never mounted.
    await act(async () => {});
    expect(joyrideSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("replay"));
    await waitFor(() => expect(lastProps().run).toBe(true));
  });

  test("renders with the custom tooltip component (replacing Joyride's default + its corner X)", async () => {
    renderTour(
      <TourProvider>
        <div />
      </TourProvider>,
    );
    await waitFor(() =>
      expect((lastProps() as { tooltipComponent?: unknown }).tooltipComponent).toBe(TourTooltip),
    );
  });

  test("Abandon from the running tour stops it and marks it seen (Replay still works)", async () => {
    renderTour(
      <TourProvider>
        <Replayer />
      </TourProvider>,
    );
    // Fresh user → auto-starts; the mock renders the tooltip while running.
    await waitFor(() => expect(lastProps().run).toBe(true));
    expect(hasSeenTour(7)).toBe(false);

    await userEvent.click(screen.getByText("Abandon"));
    expect(hasSeenTour(7)).toBe(true);
    // Abandon bumps tourKey, so the (already-loaded) Joyride stays mounted with run=false.
    expect(lastProps().run).toBe(false);

    // Replay re-runs it even though Abandon marked it seen.
    await userEvent.click(screen.getByText("replay"));
    await waitFor(() => expect(lastProps().run).toBe(true));
  });

  test("startTutorial('feedbacks') runs the tutorial's own (audience-filtered) step list, read-only", async () => {
    const user = userEvent.setup();
    renderTour(
      <TourProvider>
        <TutorialStarter />
      </TourProvider>,
    );

    await user.click(screen.getByText("start-tutorial"));
    // Non-manager (the beforeEach fetch stub reports zero managed teams): 9 of the tutorial's
    // 12 steps — My team / Reports scope / Request feedback are manager-only.
    await waitFor(() => expect(lastProps().steps).toHaveLength(9));
    expect(
      lastProps().steps.every(
        (s) => (s as unknown as { blockTargetInteraction?: boolean }).blockTargetInteraction === true,
      ),
    ).toBe(true);
  });

  test("Pause is hidden while a tutorial runs", async () => {
    const user = userEvent.setup();
    renderTour(
      <TourProvider>
        <TutorialStarter />
      </TourProvider>,
    );

    await user.click(screen.getByText("start-tutorial"));
    await waitFor(() => expect(lastProps().run).toBe(true));

    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.getByText("Abandon")).toBeInTheDocument();
  });

  test("finishing a tutorial navigates to its home and never marks the whirlwind seen", async () => {
    const user = userEvent.setup();
    renderTour(
      <TourProvider>
        <TutorialStarter />
        <LocationProbe />
      </TourProvider>,
    );

    await user.click(screen.getByText("start-tutorial"));
    await waitFor(() => expect(lastProps().steps).toHaveLength(9));

    await act(async () => {
      lastProps().onEvent({}, controlsWithStatus("finished"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/feedback?tab=received"),
    );
    expect(hasSeenTour(7)).toBe(false);
  });

  test("launchTutorial from another page opens the tutorial's home first, then starts it", async () => {
    const user = userEvent.setup();
    renderTour(
      <TourProvider>
        <TutorialLauncher />
        <LocationProbe />
      </TourProvider>,
    );
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);

    await user.click(screen.getByText("launch-tutorial"));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/feedback?tab=received"),
    );
    await waitFor(() => expect(lastProps().run).toBe(true));
    expect(lastProps().steps).toHaveLength(9);
  });

  test("launchTutorial on the tutorial's own hub starts it without navigating", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider env="test" theme={theme}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={["/feedback?tab=provided"]}>
            <TourProvider>
              <TutorialLauncher />
              <LocationProbe />
            </TourProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    await user.click(screen.getByText("launch-tutorial"));

    await waitFor(() => expect(lastProps().run).toBe(true));
    // Any tab of the hub counts as home — the tutorial's own steps switch tabs.
    expect(screen.getByTestId("location")).toHaveTextContent("/feedback?tab=provided");
  });

  test("a launch overtaken by a navigation elsewhere is dropped, never started later", async () => {
    const user = userEvent.setup();
    // Seen already, so the whirlwind's own auto-start stays out of the "nothing ran" check.
    localStorage.setItem("lettuce.tour.seen.7", "1");
    renderTour(
      <TourProvider>
        <OvertakenLauncher />
        <TutorialLauncher />
        <LocationProbe />
      </TourProvider>,
    );

    await user.click(screen.getByText("launch-then-leave"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/kudos"));
    expect(joyrideSpy.mock.calls.some(([props]) => (props as JoyrideProps).run)).toBe(false);
  });

  test("a launch the route blocker holds starts nothing, even after the user then leaves elsewhere", async () => {
    // The real discard-guard shape (DiscardGuard's useBlocker on a data router): the launch's
    // navigation is held, the user dismisses the prompt, then goes somewhere else.
    localStorage.setItem("lettuce.tour.seen.7", "1");
    function DirtyForm() {
      const navigate = useNavigate();
      const blocker = useBlocker(({ historyAction }) => historyAction !== "REPLACE");
      return (
        <>
          <div data-testid="blocker">{blocker.state}</div>
          <button onClick={() => blocker.reset?.()}>dismiss-prompt</button>
          <TutorialLauncher />
          <button onClick={() => navigate("/kudos", { replace: true })}>leave-elsewhere</button>
          <LocationProbe />
        </>
      );
    }
    const router = createMemoryRouter(
      [{ path: "*", element: <TourProvider><DirtyForm /></TourProvider> }],
      { initialEntries: ["/goals/new"] },
    );
    const user = userEvent.setup();
    render(
      <MantineProvider env="test" theme={theme}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </MantineProvider>,
    );

    await user.click(screen.getByText("launch-tutorial"));
    await waitFor(() => expect(screen.getByTestId("blocker")).toHaveTextContent("blocked"));
    expect(screen.getByTestId("location")).toHaveTextContent("/goals/new");
    await user.click(screen.getByText("dismiss-prompt"));
    await waitFor(() => expect(screen.getByTestId("blocker")).toHaveTextContent("unblocked"));
    await user.click(screen.getByText("leave-elsewhere"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/kudos"));
    expect(joyrideSpy.mock.calls.some(([props]) => (props as JoyrideProps).run)).toBe(false);
  });

  test("abandoning a tutorial navigates to its home and never marks the whirlwind seen", async () => {
    const user = userEvent.setup();
    renderTour(
      <TourProvider>
        <TutorialStarter />
        <LocationProbe />
      </TourProvider>,
    );

    await user.click(screen.getByText("start-tutorial"));
    await waitFor(() => expect(lastProps().steps).toHaveLength(9));

    await user.click(screen.getByText("Abandon"));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/feedback?tab=received"),
    );
    expect(hasSeenTour(7)).toBe(false);
    expect(lastProps().run).toBe(false);
  });

  test("startTour after a tutorial rebuilds the whirlwind's step list", async () => {
    const user = userEvent.setup();
    renderTour(
      <TourProvider>
        <TutorialStarter />
        <Replayer />
      </TourProvider>,
    );

    await user.click(screen.getByText("start-tutorial"));
    await waitFor(() => expect(lastProps().steps).toHaveLength(9));
    // Tutorial steps never carry the whirlwind's Config anchor.
    expect(lastProps().steps.some((s) => s.target === '[data-tour="nav-config"]')).toBe(false);

    await user.click(screen.getByText("replay"));
    await waitFor(() =>
      expect(lastProps().steps.some((s) => s.target === '[data-tour="nav-config"]')).toBe(true),
    );
  });
});

// Build a minimal-but-typed TooltipRenderProps for rendering TourTooltip in isolation. Only the
// fields the component reads are meaningful; the rest satisfy the type.
type TooltipProps = Parameters<typeof TourTooltip>[0];
const buttonProps = (action: string) => ({
  "aria-label": action,
  "data-action": action,
  onClick: vi.fn(),
  role: "button",
  title: action,
});
const makeTooltipProps = (overrides: Partial<TooltipProps> = {}): TooltipProps =>
  ({
    step: { title: "Step 1 of 3", content: "Welcome to the tour" },
    index: 0,
    isLastStep: false,
    size: 3,
    continuous: true,
    backProps: buttonProps("back"),
    primaryProps: buttonProps("primary"),
    closeProps: buttonProps("close"),
    skipProps: buttonProps("skip"),
    tooltipProps: { "aria-modal": true, role: "dialog" },
    controls: { close: vi.fn(), info: () => ({}) },
    ...overrides,
  }) as unknown as TooltipProps;

describe("TourTooltip", () => {
  // Back/primary carry Joyride's own aria-label (which overrides the accessible name), so assert on
  // the visible label text instead of the accessible-name role query.
  test("shows Pause + Abandon + Next (no Back on the first step) and renders step content", () => {
    const props = makeTooltipProps();
    renderWithProviders(<TourTooltip {...props} />);

    expect(screen.getByText("Welcome to the tour")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Abandon")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    // First step → no Back.
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  test("Pause calls controls.close() (the old 'x' behavior: keep the resumable beacon)", async () => {
    const close = vi.fn();
    const props = makeTooltipProps({ controls: { close, info: () => ({}) } as never });
    renderWithProviders(<TourTooltip {...props} />);

    await userEvent.click(screen.getByText("Pause"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("Abandon invokes the provider's abandon action", async () => {
    const abandon = vi.fn();
    const props = makeTooltipProps();
    renderWithProviders(
      <TourActionsContext.Provider value={{ abandon }}>
        <TourTooltip {...props} />
      </TourActionsContext.Provider>,
    );

    await userEvent.click(screen.getByText("Abandon"));
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  test("shows Back from the second step on, and 'Done' on the last step", () => {
    const props = makeTooltipProps({ index: 2, isLastStep: true });
    renderWithProviders(<TourTooltip {...props} />);

    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  test("hides Pause when the running tour reports itself not pausable (a tutorial)", () => {
    const props = makeTooltipProps();
    renderWithProviders(
      <TourActionsContext.Provider value={{ abandon: vi.fn(), pausable: false }}>
        <TourTooltip {...props} />
      </TourActionsContext.Provider>,
    );

    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.getByText("Abandon")).toBeInTheDocument();
  });

  test("renders non-string step content raw (not wrapped in Text) in the wider box", () => {
    // tooltipProps (spread onto the Paper) carries role="dialog", so the Paper itself is the
    // dialog-role element — a robust handle regardless of Mantine's injected <style> tags.
    renderWithProviders(<TourTooltip {...makeTooltipProps()} />);
    const plainPaper = screen.getByRole("dialog");
    cleanup();

    const richProps = makeTooltipProps({
      step: { title: "Step 2 of 3", content: <svg data-testid="diagram" role="img" /> } as never,
    });
    renderWithProviders(<TourTooltip {...richProps} />);
    const richPaper = screen.getByRole("dialog");

    // An SVG inside Mantine Text's <p> is invalid HTML, so rich content skips it entirely.
    expect(screen.getByTestId("diagram")).toBeInTheDocument();
    // The wide box (maw=560) beats the ordinary text box (maw=360) — implementation-agnostic:
    // just assert the rich Paper is strictly wider, not a pinned unit/value. Mantine renders
    // `maw` as `max-width: calc(<rem> * var(--mantine-scale))`, not a bare px/rem value.
    const remValue = (style: string) => Number(/calc\(([\d.]+)rem/.exec(style)?.[1] ?? NaN);
    expect(remValue(richPaper.style.maxWidth)).toBeGreaterThan(remValue(plainPaper.style.maxWidth));
  });
});
