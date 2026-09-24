import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import AppDatesProvider from "../components/AppDatesProvider";
import { buildSteps, TourContext } from "../components/tourSupport";
import { daysOffCreateLink, daysOffListLink } from "../utils/daysOffLinks";
import { DAYS_OFF_TUTORIAL } from "./daysOff";
import DaysOff from "../pages/DaysOff";
import CreateDaysOff from "../pages/CreateDaysOff";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

describe("DAYS_OFF_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("8 steps for a non-manager, 12 for a manager — exactly the manager-gated targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(DAYS_OFF_TUTORIAL.steps, t, false);
    const manager = buildSteps(DAYS_OFF_TUTORIAL.steps, t, true);

    // The scope picker's step is managerOrHr since v3.25.0 (the HR auditor's org-wide scope
    // lives in that Select) — for a plain manager vs. non-manager the split is unchanged.
    const managerOnlyTargets = [
      '[data-tour="days-off-calendar-scope"]',
      '[data-tour="days-off-team"]',
      '[data-tour="days-off-team-view"]',
      '[data-tour="days-off-record"]',
    ];
    expect(nonManager).toHaveLength(8);
    expect(manager).toHaveLength(12);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is the intro step only — unlike feedbacks/goals, this tutorial has no other
    // concept step (there is no lifecycle to diagram since v3.9.0): 1 for everyone.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(1);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(1);
  });

  test("an HR auditor who manages nobody still gets the calendar-scope step (v3.25.0)", () => {
    const t = (k: string) => k;
    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    try {
      const auditor = buildSteps(DAYS_OFF_TUTORIAL.steps, t, false);
      // The scope Select renders for managers AND auditors, so its step must too — the three
      // genuinely manager-only steps (team tab, team view, record) stay out.
      expect(auditor).toHaveLength(9);
      expect(auditor.some((s) => s.target === '[data-tour="days-off-calendar-scope"]')).toBe(true);
      for (const target of ['[data-tour="days-off-team"]', '[data-tour="days-off-team-view"]', '[data-tour="days-off-record"]']) {
        expect(auditor.some((s) => s.target === target), target).toBe(false);
      }
    } finally {
      localStorage.removeItem(ROLE_KEY);
    }
  });

  test("a caller without DAYS_OFF enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["DAYS_OFF"]));
    const t = (k: string) => k;
    expect(buildSteps(DAYS_OFF_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const steps = buildSteps(DAYS_OFF_TUTORIAL.steps, t, true, navigateTo, 7);

    const CALENDAR = daysOffListLink("calendar");
    const REQUESTS = daysOffListLink("requests");
    const TEAM = daysOffListLink("team");
    const FORM_URL = daysOffCreateLink(REQUESTS);
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="days-off-calendar"]', path: CALENDAR },
      { target: '[data-tour="days-off-calendar-scope"]', path: CALENDAR },
      { target: '[data-tour="days-off-month"]', path: CALENDAR },
      { target: '[data-tour="days-off-requests"]', path: REQUESTS },
      { target: '[data-tour="days-off-budget"]', path: REQUESTS },
      { target: '[data-tour="days-off-team"]', path: TEAM },
      { target: '[data-tour="days-off-team-view"]', path: TEAM },
      { target: '[data-tour="days-off-record"]', path: TEAM },
      { target: '[data-tour="days-off-new"]', path: REQUESTS },
      { target: '[data-tour="days-off-form"]', path: FORM_URL },
      { target: '[data-tour="days-off-form-actions"]', path: FORM_URL },
    ];
    // Exhaustive: every navTo-carrying step in the tutorial is covered above (the whirlwind
    // Tour.test.tsx idiom) — a newly added navigating step fails here until it is added.
    expect(cases.map((c) => c.target).sort()).toEqual(
      DAYS_OFF_TUTORIAL.steps.filter((s) => s.navTo).map((s) => s.target).sort(),
    );
    for (const { target, path } of cases) {
      const step = steps.find((s) => s.target === target);
      expect(step, `missing step for ${path}`).toBeDefined();
      await step!.before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The lone concept step (intro) shares the "body" target and never navigates.
    navigateTo.mockClear();
    const bodySteps = steps.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(1);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the Days-off hub
// and the create form actually exists once those pages are rendered under realistic mocks
// (the goals.test.tsx idiom, using DaysOff.test.tsx's mock shape).

function daysOffPageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      const items =
        managerOfTeams > 0
          ? [{ id: 1, name: "Platform", managerId: 7, managerName: "Me", managerDeleted: false }]
          : [];
      return jsonResponse(200, { items, page: 1, pageSize: 1, total: managerOfTeams });
    }
    if (u.startsWith("/api/v1/days-off/calendar")) {
      return jsonResponse(200, { month: "2026-08", holidays: [], users: [] });
    }
    if (u.startsWith("/api/v1/days-off/budgets")) {
      return jsonResponse(200, { items: [] });
    }
    if (u.startsWith("/api/v1/days-off?")) {
      return jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 });
    }
    return jsonResponse(200, { items: [] });
  };
}

function createFormHandler(url: string): Response {
  const u = String(url);
  if (u.includes("/api/v1/public-holidays")) return jsonResponse(200, { items: [] });
  if (u.includes("/api/v1/days-off/budgets")) return jsonResponse(200, { items: [] });
  return jsonResponse(200, { items: [] });
}

// A no-op TourContext — DaysOff's header TutorialButton needs one; this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/DaysOff.test.tsx and
// components/Tour.test.tsx). Both helpers assume `fetch` is already stubbed by the caller.
function renderDaysOffHub(route: string) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {}, launchTutorial: () => {} }}>
            <MemoryRouter initialEntries={[route]}>
              <DaysOff />
            </MemoryRouter>
          </TourContext.Provider>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

function renderCreateDaysOffSelf() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/days-off/new"]}>
          <Routes>
            <Route path="/days-off/new" element={<CreateDaysOff />} />
            <Route path="/days-off" element={<div>LIST</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("days-off tutorial anchors exist on the real pages", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    cleanup();
  });

  test("every Days-off-hub anchor mounts for a manager on the team tab", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(daysOffPageHandler(1)(String(url))));
    renderDaysOffHub("/days-off?tab=team");

    // Wait for the manager-only "My team" tab to actually mount before probing its anchors.
    await screen.findByRole("tab", { name: "My team" });

    for (const target of [
      '[data-tour="days-off-calendar"]',
      '[data-tour="days-off-requests"]',
      '[data-tour="days-off-team"]',
      '[data-tour="days-off-team-view"]',
      '[data-tour="days-off-record"]',
      '[data-tour="days-off-new"]',
      '[data-tour="days-off-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("the calendar tab's scope and month anchors mount, and the scope anchor rides wrapperProps (not the <input>)", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(daysOffPageHandler(1)(String(url))));
    renderDaysOffHub("/days-off?tab=calendar");

    // The scope Select mounts unconditionally for a manager — no need to wait for the
    // (empty, in this mock) calendar grid itself. Mantine associates both the label and the
    // input with the text (the DaysOff.test.tsx idiom) — any match will do.
    await waitFor(() => expect(screen.getAllByLabelText("Whose calendar").length).toBeGreaterThan(0));

    for (const target of ['[data-tour="days-off-calendar-scope"]', '[data-tour="days-off-month"]']) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
    // Mantine 9.6 spreads unknown Select props onto the <input> — pinning wrapperProps keeps
    // the spotlight on the label+input pair, not a lone <input>.
    const scopeAnchor = document.querySelector('[data-tour="days-off-calendar-scope"]');
    expect(scopeAnchor?.tagName).not.toBe("INPUT");
  });

  test("the requests tab's budget anchor mounts", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(daysOffPageHandler(0)(String(url))));
    renderDaysOffHub("/days-off?tab=requests");

    await screen.findByRole("tab", { name: "My days off" });
    expect(document.querySelector('[data-tour="days-off-budget"]')).not.toBeNull();
  });

  test("every create-form anchor mounts in self mode, with no on-behalf field", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(createFormHandler(String(url))));
    renderCreateDaysOffSelf();

    await screen.findByText("New days off");

    for (const target of ['[data-tour="days-off-form"]', '[data-tour="days-off-form-actions"]']) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
    expect(screen.queryByRole("combobox", { name: "On behalf of" })).toBeNull();
  });

  test("neither render ever mutates, nor hits /teams/members or onBehalf — every request is method-less or GET, self mode only", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(daysOffPageHandler(1)(String(url))));
    renderDaysOffHub("/days-off?tab=team");
    await screen.findByRole("tab", { name: "My team" });
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(createFormHandler(String(url))));
    renderCreateDaysOffSelf();
    await screen.findByText("New days off");

    for (const [url, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
      expect(String(url)).not.toContain("/teams/members");
      expect(String(url)).not.toContain("onBehalf");
    }
  });
});
