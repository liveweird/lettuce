import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import AppDatesProvider from "../components/AppDatesProvider";
import { buildSteps, TourContext } from "../components/tourSupport";
import { PULSE_TUTORIAL } from "./pulse";
import Pulse from "../pages/Pulse";
import PulseCycles from "../pages/PulseCycles";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

describe("PULSE_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
    localStorage.removeItem(ROLE_KEY);
  });

  test("7 steps for a member, 8 for a manager or HR, 11 for an admin non-manager, 12 for an admin manager", () => {
    const t = (k: string) => k;

    localStorage.removeItem(ROLE_KEY);
    const member = buildSteps(PULSE_TUTORIAL.steps, t, false);
    const manager = buildSteps(PULSE_TUTORIAL.steps, t, true);

    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    const hrNonManager = buildSteps(PULSE_TUTORIAL.steps, t, false);

    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    const adminNonManager = buildSteps(PULSE_TUTORIAL.steps, t, false);
    const adminManager = buildSteps(PULSE_TUTORIAL.steps, t, true);

    expect(member).toHaveLength(7);
    expect(manager).toHaveLength(8);
    expect(hrNonManager).toHaveLength(8);
    expect(adminNonManager).toHaveLength(11);
    expect(adminManager).toHaveLength(12);
  });

  test("the managerOrHr participation step and the four adminOnly cycle-management steps are gated independently", () => {
    const t = (k: string) => k;
    const participationTarget = '[data-tour="pulse-participation"]';
    const adminOnlyTargets = [
      '[data-tour="config-pulse-cycles"]',
      '[data-tour="pulse-admin-settings"]',
      '[data-tour="pulse-admin-schedule"]',
      '[data-tour="pulse-admin-cycles"]',
    ];

    localStorage.removeItem(ROLE_KEY);
    const member = buildSteps(PULSE_TUTORIAL.steps, t, false);
    const manager = buildSteps(PULSE_TUTORIAL.steps, t, true);

    expect(member.some((s) => s.target === participationTarget)).toBe(false);
    expect(manager.some((s) => s.target === participationTarget)).toBe(true);
    for (const target of adminOnlyTargets) {
      expect(member.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(false);
    }

    localStorage.setItem(ROLE_KEY, JSON.stringify(["HR"]));
    const hrNonManager = buildSteps(PULSE_TUTORIAL.steps, t, false);
    expect(hrNonManager.some((s) => s.target === participationTarget)).toBe(true);
    for (const target of adminOnlyTargets) {
      expect(hrNonManager.some((s) => s.target === target), target).toBe(false);
    }

    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    const adminNonManager = buildSteps(PULSE_TUTORIAL.steps, t, false);
    expect(adminNonManager.some((s) => s.target === participationTarget)).toBe(false);
    for (const target of adminOnlyTargets) {
      expect(adminNonManager.some((s) => s.target === target), target).toBe(true);
    }
  });

  test("the three concept (body) steps ride every audience", () => {
    const t = (k: string) => k;
    localStorage.removeItem(ROLE_KEY);
    const member = buildSteps(PULSE_TUTORIAL.steps, t, false);
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    const adminManager = buildSteps(PULSE_TUTORIAL.steps, t, true);

    expect(member.filter((s) => s.target === "body")).toHaveLength(3);
    expect(adminManager.filter((s) => s.target === "body")).toHaveLength(3);
  });

  test("a caller without PULSE_SURVEYS enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["PULSE_SURVEYS"]));
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    const t = (k: string) => k;
    expect(buildSteps(PULSE_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive, index-paired table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    const adminManager = buildSteps(PULSE_TUTORIAL.steps, t, true, navigateTo, 7);

    // Exhaustive: every navTo-carrying step definition, in the def table's own order. "survey"
    // and "end" deliberately share both target and destination — the shared last step
    // re-spotlights Current survey — so this is index-paired against the def list rather than
    // looked up by target (a target-keyed lookup couldn't tell the two apart; the impactLog/
    // teamKpis precedent).
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="pulse-survey"]', path: "/pulse?tab=survey" },
      { target: '[data-tour="pulse-results"]', path: "/pulse?tab=results" },
      { target: '[data-tour="pulse-trend"]', path: "/pulse?tab=trend" },
      { target: '[data-tour="pulse-participation"]', path: "/pulse?tab=participation" },
      { target: '[data-tour="config-pulse-cycles"]', path: "/pulse-cycles" },
      { target: '[data-tour="pulse-admin-settings"]', path: "/pulse-cycles" },
      { target: '[data-tour="pulse-admin-schedule"]', path: "/pulse-cycles" },
      { target: '[data-tour="pulse-admin-cycles"]', path: "/pulse-cycles" },
      { target: '[data-tour="pulse-survey"]', path: "/pulse?tab=survey" },
    ];
    const navDefs = PULSE_TUTORIAL.steps.filter((s) => s.navTo);
    expect(cases.map((c) => c.target).sort()).toEqual(navDefs.map((s) => s.target).sort());
    expect(cases.map((c) => c.path).sort()).toEqual(navDefs.map((s) => s.navTo).sort());

    let caseIndex = 0;
    for (let i = 0; i < PULSE_TUTORIAL.steps.length; i++) {
      const def = PULSE_TUTORIAL.steps[i];
      if (!def.navTo) continue;
      const { target, path } = cases[caseIndex++];
      expect(def.target).toBe(target);
      await adminManager[i].before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The three concept steps (intro, questions, anonymity) share the "body" target and never
    // navigate.
    navigateTo.mockClear();
    const bodySteps = adminManager.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(3);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the Pulse hub and
// the admin Pulse cycles page actually exists once those pages are rendered under realistic
// mocks — the Pulse.test.tsx / PulseCycles.test.tsx mock shapes (the teamKpis/impactLog idiom).
// A fresh DB has no pulse cycle, so both mock shapes deliberately carry none.

const SETTINGS = { cadenceWeeks: 4, openDays: 7 };

function pulseHubHandler(managedTotal: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.includes("/api/v1/teams?")) {
      return jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managedTotal });
    }
    if (u.includes("/pulse-surveys/cycles")) return jsonResponse(200, { items: [] });
    if (u.includes("/visible-teams")) {
      return jsonResponse(200, { resultsTeams: [], monitoredTeams: [], memberTeams: [] });
    }
    return jsonResponse(200, { items: [] });
  };
}

function pulseCyclesPageHandler() {
  return (url: string): Response => {
    const u = String(url);
    if (u.includes("/pulse-surveys/settings")) return jsonResponse(200, SETTINGS);
    if (u.includes("/pulse-surveys/cycles")) return jsonResponse(200, { items: [] });
    return jsonResponse(200, { items: [] });
  };
}

// A no-op TourContext — the hub header's TutorialButton needs one; this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/Pulse.test.tsx).
function renderPulseHub(route: string) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {} }}>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path="/pulse" element={<Pulse />} />
              </Routes>
            </MemoryRouter>
          </TourContext.Provider>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

function renderPulseCycles() {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={["/pulse-cycles"]}>
            <Routes>
              <Route path="/pulse-cycles" element={<PulseCycles />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

describe("pulse tutorial anchors exist on the real pages", () => {
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

  test("every hub-tab anchor and the tutorial button mount for a manager, with no cycle", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pulseHubHandler(1)(String(url))));
    renderPulseHub("/pulse?tab=survey");

    // The participation tab only mounts once useIsManager's managedTeams query resolves.
    await screen.findByRole("tab", { name: "Participation" });

    for (const target of [
      '[data-tour="pulse-survey"]',
      '[data-tour="pulse-results"]',
      '[data-tour="pulse-trend"]',
      '[data-tour="pulse-participation"]',
      '[data-tour="pulse-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("the admin registry page's four anchors mount for an admin", async () => {
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    mockFetch.mockImplementation((url: string) => Promise.resolve(pulseCyclesPageHandler()(String(url))));
    renderPulseCycles();

    await screen.findByRole("heading", { name: "Pulse cycles" });

    for (const target of [
      '[data-tour="config-pulse-cycles"]',
      '[data-tour="pulse-admin-settings"]',
      '[data-tour="pulse-admin-schedule"]',
      '[data-tour="pulse-admin-cycles"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pulseHubHandler(1)(String(url))));
    renderPulseHub("/pulse?tab=survey");
    await screen.findByRole("tab", { name: "Current survey" });
    cleanup();

    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
    mockFetch.mockImplementation((url: string) => Promise.resolve(pulseCyclesPageHandler()(String(url))));
    renderPulseCycles();
    await screen.findByRole("heading", { name: "Pulse cycles" });

    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
