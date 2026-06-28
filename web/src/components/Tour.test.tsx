import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Stub react-joyride (it measures DOM rects under a real browser) and capture the props it receives.
const joyrideSpy = vi.hoisted(() => vi.fn());
vi.mock("react-joyride", () => ({
  Joyride: (props: Record<string, unknown>) => {
    joyrideSpy(props);
    return null;
  },
  STATUS: { FINISHED: "finished", SKIPPED: "skipped", RUNNING: "running" },
}));

import { TourProvider, useTour, buildSteps, hasSeenTour, waitForElement, TOUR_STEPS } from "./Tour";

const USER_ID_KEY = "lettuce.auth.userId";
const ROLE_KEY = "lettuce.auth.role";

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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("Tour", () => {
  beforeEach(() => {
    joyrideSpy.mockClear();
    localStorage.clear();
    localStorage.setItem(USER_ID_KEY, "7");
    localStorage.setItem(ROLE_KEY, "USER");
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

  test("buildSteps gates the Feedback 'My team' step on being a manager", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(t, false);
    const manager = buildSteps(t, true);

    expect(nonManager.some((s) => s.target === '[data-tour="feedback-team"]')).toBe(false);
    expect(manager.some((s) => s.target === '[data-tour="feedback-team"]')).toBe(true);
    expect(manager.length).toBe(nonManager.length + 1);
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
    // manager=true so the Feedback "My team" step is included.
    const steps = buildSteps(t, true, navigateTo);

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
      { target: '[data-tour="nav-config"]', path: "/users" },
      { target: '[data-tour="config-users"]', path: "/users" },
      { target: '[data-tour="config-teams"]', path: "/teams" },
      { target: '[data-tour="config-templates"]', path: "/templates" },
    ];
    for (const { target, path } of cases) {
      const step = steps.find((s) => s.target === target);
      expect(step, `missing step for ${path}`).toBeDefined();
      await step!.before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // A step without navTo (the welcome step) carries no before hook.
    const welcome = steps.find((s) => s.target === "body");
    expect(welcome?.before).toBeUndefined();
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
    expect(lastProps().run).toBe(true);
    expect(hasSeenTour(7)).toBe(false);

    // Finishing the tour persists the per-user flag and stops it.
    await act(async () => {
      lastProps().onEvent({}, controlsWithStatus("finished"));
    });
    expect(hasSeenTour(7)).toBe(true);
    expect(lastProps().run).toBe(false);

    // A fresh mount for the same user does not auto-start again.
    cleanup();
    joyrideSpy.mockClear();
    renderTour(
      <TourProvider>
        <div />
      </TourProvider>,
    );
    expect(lastProps().run).toBe(false);
  });

  test("Replay starts the tour even after it has been seen", async () => {
    localStorage.setItem("lettuce.tour.seen.7", "1");
    renderTour(
      <TourProvider>
        <Replayer />
      </TourProvider>,
    );
    expect(lastProps().run).toBe(false); // already seen → no auto-start

    await userEvent.click(screen.getByText("replay"));
    expect(lastProps().run).toBe(true);
  });
});
