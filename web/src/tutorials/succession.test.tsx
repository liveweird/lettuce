import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { buildSteps, TourContext } from "../components/tourSupport";
import { SUCCESSION_TUTORIAL } from "./succession";
import SuccessionPlans from "../pages/SuccessionPlans";
import CreateSuccessionPlan from "../pages/CreateSuccessionPlan";
import { jsonResponse } from "../test/http";
import { successionPlanCreateLink } from "../utils/successionLinks";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };
// The create form's URL from the hub header's own "New plan" entry point.
const FORM_URL = successionPlanCreateLink("/succession?tab=own");

describe("SUCCESSION_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("5 steps for a non-manager, 13 for a manager — exactly the managerOnly targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(SUCCESSION_TUTORIAL.steps, t, false);
    const manager = buildSteps(SUCCESSION_TUTORIAL.steps, t, true);

    const managerOnlyTargets = [
      '[data-tour="succession-team"]',
      '[data-tour="succession-new"]',
      '[data-tour="succession-form-seat"]',
      '[data-tour="succession-form-loss-impact"]',
      '[data-tour="succession-form-actions"]',
      '[data-tour="dashboard-subordinates"]',
    ];
    expect(nonManager).toHaveLength(5);
    expect(manager).toHaveLength(13);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is shared by intro/access (everyone) and nominations/review (managerOnly): 2 vs 4.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(2);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(4);
  });

  test("a caller without SUCCESSION_PLANS enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["SUCCESSION_PLANS"]));
    const t = (k: string) => k;
    expect(buildSteps(SUCCESSION_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive, index-paired table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const manager = buildSteps(SUCCESSION_TUTORIAL.steps, t, true, navigateTo, 7);

    // Exhaustive: every navTo-carrying step definition, in the def table's own order. "own" and
    // "end" deliberately share both target and destination — the shared last step re-spotlights
    // My plans — so this is index-paired against the def list rather than looked up by target
    // (a target-keyed lookup couldn't tell the two apart; the impactLog/teamKpis precedent).
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="succession-own"]', path: "/succession?tab=own" },
      { target: '[data-tour="succession-filters"]', path: "/succession?tab=own" },
      { target: '[data-tour="succession-team"]', path: "/succession?tab=team" },
      { target: '[data-tour="succession-new"]', path: "/succession?tab=own" },
      { target: '[data-tour="succession-form-seat"]', path: FORM_URL },
      { target: '[data-tour="succession-form-loss-impact"]', path: FORM_URL },
      { target: '[data-tour="succession-form-actions"]', path: FORM_URL },
      { target: '[data-tour="dashboard-subordinates"]', path: "/?tab=subordinates" },
      { target: '[data-tour="succession-own"]', path: "/succession?tab=own" },
    ];
    const navDefs = SUCCESSION_TUTORIAL.steps.filter((s) => s.navTo);
    expect(cases.map((c) => c.target).sort()).toEqual(navDefs.map((s) => s.target).sort());
    expect(cases.map((c) => c.path).sort()).toEqual(navDefs.map((s) => s.navTo).sort());

    let caseIndex = 0;
    for (let i = 0; i < SUCCESSION_TUTORIAL.steps.length; i++) {
      const def = SUCCESSION_TUTORIAL.steps[i];
      if (!def.navTo) continue;
      const { target, path } = cases[caseIndex++];
      expect(def.target).toBe(target);
      await manager[i].before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The four concept steps (intro, nominations, review, access) share the "body" target and
    // never navigate.
    navigateTo.mockClear();
    const bodySteps = manager.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(4);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the succession
// hub and the create form actually exists once those pages are rendered under realistic mocks
// (the oneOnOnes.test.tsx/impactLog.test.tsx idiom, using SuccessionPlans.test.tsx's mock shape).

function successionPageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      // useIsManager probes for a team the caller manages.
      return jsonResponse(200, { ...EMPTY_PAGE, total: managerOfTeams });
    }
    if (u.startsWith("/api/v1/succession-plans?")) {
      return jsonResponse(200, EMPTY_PAGE);
    }
    return jsonResponse(200, EMPTY_PAGE);
  };
}

// A no-op TourContext — the hub header's TutorialButton needs one; this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/SuccessionPlans.test.tsx).
function renderSuccessionHub(route: string) {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {}, launchTutorial: () => {} }}>
          <MemoryRouter initialEntries={[route]}>
            <SuccessionPlans />
          </MemoryRouter>
        </TourContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

function renderCreateSuccessionPlan() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/succession/new"]}>
          <Routes>
            <Route path="/succession/new" element={<CreateSuccessionPlan />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("succession plans tutorial anchors exist on the real pages", () => {
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

  test("the own-tab anchors mount for a manager", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(successionPageHandler(1)(String(url))));
    renderSuccessionHub("/succession?tab=own");

    await screen.findByRole("tab", { name: "My subordinates' plans" });

    for (const target of [
      '[data-tour="succession-own"]',
      '[data-tour="succession-filters"]',
      '[data-tour="succession-new"]',
      '[data-tour="succession-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("the team-tab anchor mounts for a manager, and the own tab's filter panel unmounts", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(successionPageHandler(1)(String(url))));
    renderSuccessionHub("/succession?tab=team");

    await screen.findByRole("tab", { name: "My subordinates' plans" });

    expect(document.querySelector('[data-tour="succession-team"]')).not.toBeNull();
    // The own tab's Tabs.Panel is keepMounted={false} — its Filters toggle should not mount here.
    expect(document.querySelector('[data-tour="succession-filters"]')).toBeNull();
  });

  test("every create-form anchor mounts", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(successionPageHandler(0)(String(url))));
    renderCreateSuccessionPlan();

    await screen.findByLabelText("Person", { selector: "input" });

    for (const target of [
      '[data-tour="succession-form-seat"]',
      '[data-tour="succession-form-loss-impact"]',
      '[data-tour="succession-form-actions"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(successionPageHandler(1)(String(url))));
    renderSuccessionHub("/succession?tab=own");
    await screen.findByRole("tab", { name: "My subordinates' plans" });
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(successionPageHandler(0)(String(url))));
    renderCreateSuccessionPlan();
    await screen.findByLabelText("Person", { selector: "input" });

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(0));
    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
