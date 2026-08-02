import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
} from "./tourSupport";
import { renderWithProviders } from "../test/render";

const USER_ID_KEY = "lettuce.auth.userId";
const ROLE_KEY = "lettuce.auth.roles";

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

  test("buildSteps resolves content through the translator and includes Config for everyone", () => {
    const t = (k: string) => k;
    const steps = buildSteps(t, false);

    // Config is no longer admin-gated — its nav + subsection steps are present for any caller.
    expect(steps.some((s) => s.target === '[data-tour="nav-config"]')).toBe(true);
    expect(steps.some((s) => s.target === '[data-tour="config-users"]')).toBe(true);
    expect(steps.some((s) => s.target === '[data-tour="config-teams"]')).toBe(true);
    expect(steps.some((s) => s.target === '[data-tour="config-templates"]')).toBe(true);
    // Content is resolved through the translator.
    expect(steps[0].content).toBe(TOUR_STEPS[0].contentKey);
  });

  test("buildSteps gates the manager-only steps on being a manager", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(t, false);
    const manager = buildSteps(t, true);

    // Feedback "My team", the two manager-side 1:1 tabs, the manager-side Goals and Team-KPI
    // tabs, and the Dashboard's reviews tab are manager-only.
    const managerOnlyTargets = [
      '[data-tour="dashboard-reviews"]',
      '[data-tour="feedback-team"]',
      '[data-tour="one-on-one-managed"]',
      '[data-tour="one-on-one-team"]',
      '[data-tour="goals-managed"]',
      '[data-tour="team-kpis-managed"]',
    ];
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    expect(manager.length).toBe(nonManager.length + managerOnlyTargets.length);
    // The 1:1 nav step and its "own" tab are for everyone — as is the Goals "My goals" tab.
    expect(nonManager.some((s) => s.target === '[data-tour="nav-one-on-ones"]')).toBe(true);
    expect(nonManager.some((s) => s.target === '[data-tour="one-on-one-own"]')).toBe(true);
    expect(nonManager.some((s) => s.target === '[data-tour="goals-own"]')).toBe(true);
    expect(nonManager.some((s) => s.target === '[data-tour="team-kpis-own"]')).toBe(true);
    // My performance is for everyone — one's own published reviews.
    expect(nonManager.some((s) => s.target === '[data-tour="nav-my-performance"]')).toBe(true);
  });

  test("buildSteps numbers each step header as 'Step X of Y' against the filtered total", () => {
    // A translator that honours interpolation, so we can read the computed current/total.
    const t = (k: string, o?: Record<string, unknown>) => (o ? `${o.current}/${o.total}` : k);

    const steps = buildSteps(t, false);
    const total = steps.length;
    expect(steps[0].title).toBe(`1/${total}`);
    expect(steps[total - 1].title).toBe(`${total}/${total}`);
  });

  test("steps with a navTo change the view via their before hook before showing", async () => {
    const t = (k: string) => k;
    const navigateTo = vi.fn(() => Promise.resolve());
    // manager=true so the Feedback "My team" step is included; userId feeds the :userId navTo.
    const steps = buildSteps(t, true, navigateTo, 7);

    const cases: { target: string; path: string }[] = [
      // Each lazy section's nav step navigates a step early so its subsections' targets exist.
      { target: '[data-tour="nav-dashboard"]', path: "/?tab=managers" },
      { target: '[data-tour="dashboard-managers"]', path: "/?tab=managers" },
      { target: '[data-tour="dashboard-peers"]', path: "/?tab=peers" },
      { target: '[data-tour="dashboard-subordinates"]', path: "/?tab=subordinates" },
      { target: '[data-tour="nav-feedback"]', path: "/feedback?tab=received" },
      { target: '[data-tour="feedback-received"]', path: "/feedback?tab=received" },
      { target: '[data-tour="feedback-provided"]', path: "/feedback?tab=provided" },
      { target: '[data-tour="feedback-team"]', path: "/feedback?tab=team" },
      { target: '[data-tour="nav-one-on-ones"]', path: "/one-on-ones?tab=managed" },
      { target: '[data-tour="one-on-one-managed"]', path: "/one-on-ones?tab=managed" },
      { target: '[data-tour="one-on-one-own"]', path: "/one-on-ones?tab=own" },
      { target: '[data-tour="one-on-one-team"]', path: "/one-on-ones?tab=team" },
      { target: '[data-tour="nav-my-goals"]', path: "/goals" },
      { target: '[data-tour="goals-own"]', path: "/goals?tab=own" },
      { target: '[data-tour="goals-managed"]', path: "/goals?tab=managed" },
      { target: '[data-tour="nav-config"]', path: "/users" },
      { target: '[data-tour="config-users"]', path: "/users" },
      { target: '[data-tour="config-teams"]', path: "/teams" },
      { target: '[data-tour="config-org"]', path: "/org" },
      { target: '[data-tour="config-templates"]', path: "/templates" },
      // These anchor on the navbar leaf but also open the actual screen (":userId" resolved).
      { target: '[data-tour="nav-self-reflection"]', path: "/feedback/self" },
      { target: '[data-tour="nav-change-password"]', path: "/users/7/change-password" },
      // The closing step returns home.
      { target: '[data-tour="replay"]', path: "/" },
    ];
    for (const { target, path } of cases) {
      const step = steps.find((s) => s.target === target);
      expect(step, `missing step for ${path}`).toBeDefined();
      await step!.before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // A step without navTo (the welcome step) still has a before hook (it pins the scroll to
    // the top) but never navigates.
    navigateTo.mockClear();
    const welcome = steps.find((s) => s.target === "body");
    await welcome!.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test("a :userId navTo degrades to not navigating when the caller id is unknown", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const steps = buildSteps((k) => k, false, navigateTo, null);

    const account = steps.find((s) => s.target === '[data-tour="nav-change-password"]');
    await account!.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
    // Static navTo steps are unaffected by the missing id.
    const selfReflection = steps.find((s) => s.target === '[data-tour="nav-self-reflection"]');
    await selfReflection!.before!({} as never);
    expect(navigateTo).toHaveBeenCalledWith("/feedback/self", '[data-tour="nav-self-reflection"]');
  });

  test("every step disables Joyride scrolling and pins the window to the top itself", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      const steps = buildSteps((k) => k, true, vi.fn(() => Promise.resolve()));
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
});
