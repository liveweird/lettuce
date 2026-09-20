import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import AppDatesProvider from "../components/AppDatesProvider";
import { buildSteps, TourContext } from "../components/tourSupport";
import { goalCreateLink } from "../utils/goalLinks";
import { GOALS_TUTORIAL } from "./goals";
import MyGoals from "../pages/MyGoals";
import CreateGoal from "../pages/CreateGoal";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea, exactly like CreateGoal.test.tsx (the
// anchor smoke test below renders the real create form).
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

describe("GOALS_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("6 steps for a non-manager, 12 for a manager — exactly the managerOnly targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(GOALS_TUTORIAL.steps, t, false);
    const manager = buildSteps(GOALS_TUTORIAL.steps, t, true);

    // The five DOM-anchored managerOnly steps (the sixth, "manage", shares the "body" target
    // with three non-managerOnly steps, so it can't be asserted the same way — its presence is
    // covered by the body-step count below instead).
    const managerOnlyTargets = [
      '[data-tour="goals-managed"]',
      '[data-tour="goals-new"]',
      '[data-tour="goals-definition"]',
      '[data-tour="goals-form-actions"]',
      '[data-tour="dashboard-subordinates"]',
    ];
    expect(nonManager).toHaveLength(6);
    expect(manager).toHaveLength(12);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is shared by intro/lifecycle/progress (everyone) and manage (managerOnly): 3 vs 4.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(3);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(4);
  });

  test("a caller without GOALS enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["GOALS"]));
    const t = (k: string) => k;
    expect(buildSteps(GOALS_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const steps = buildSteps(GOALS_TUTORIAL.steps, t, true, navigateTo, 7);

    const formUrl = goalCreateLink(undefined, "/goals?tab=managed");
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="goals-own"]', path: "/goals?tab=own" },
      { target: '[data-tour="goals-filters"]', path: "/goals?tab=own" },
      { target: '[data-tour="goals-managed"]', path: "/goals?tab=managed" },
      { target: '[data-tour="goals-new"]', path: "/goals?tab=managed" },
      { target: '[data-tour="goals-definition"]', path: formUrl },
      { target: '[data-tour="goals-form-actions"]', path: formUrl },
      { target: '[data-tour="dashboard-subordinates"]', path: "/?tab=subordinates" },
      { target: '[data-tour="dashboard-managers"]', path: "/?tab=managers" },
    ];
    // Exhaustive: every navTo-carrying step in the tutorial is covered above (the whirlwind
    // Tour.test.tsx idiom) — a newly added navigating step fails here until it is added.
    expect(cases.map((c) => c.target).sort()).toEqual(
      GOALS_TUTORIAL.steps.filter((s) => s.navTo).map((s) => s.target).sort(),
    );
    for (const { target, path } of cases) {
      const step = steps.find((s) => s.target === target);
      expect(step, `missing step for ${path}`).toBeDefined();
      await step!.before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The four concept steps (intro, lifecycle, progress, manage) share the "body" target and
    // never navigate.
    navigateTo.mockClear();
    const bodySteps = steps.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(4);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the Goals hub and
// the create form actually exists once those pages are rendered under realistic mocks.
// dashboard-subordinates/dashboard-managers live on the Dashboard page — not on either page under
// test here, so they're out of scope for this smoke test (Tour.test.tsx's whirlwind suite
// already exercises those anchors).

function goalsPageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      const items =
        managerOfTeams > 0
          ? [{ id: 1, name: "Platform", managerId: 7, managerName: "Me", managerDeleted: false }]
          : [];
      return jsonResponse(200, { items, page: 1, pageSize: 1, total: managerOfTeams });
    }
    if (u.startsWith("/api/v1/goals?")) {
      return jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 });
    }
    return jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 });
  };
}

function pickerHandler(url: string): Response {
  const u = String(url);
  if (u.includes("/api/v1/teams/members")) {
    return jsonResponse(200, {
      items: [{ userId: 8, name: "Sam Subordinate", email: "sam@example.com", teamId: 1, teamName: "alpha" }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
  }
  return jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 });
}

// A no-op TourContext — MyGoals' header TutorialButton needs one, and this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/MyGoals.test.tsx and
// components/Tour.test.tsx). Both helpers assume `fetch` is already stubbed by the caller.
function renderGoalsHub(route: string) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {} }}>
            <MemoryRouter initialEntries={[route]}>
              <MyGoals />
            </MemoryRouter>
          </TourContext.Provider>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

function renderCreateGoalPicker() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/goals/new"]}>
          <Routes>
            <Route path="/goals/new" element={<CreateGoal />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("goal tutorial anchors exist on the real pages", () => {
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

  test("every Goals-hub anchor mounts for a manager on the managed tab", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(goalsPageHandler(1)(String(url))));
    renderGoalsHub("/goals?tab=managed");

    // Wait for the manager-only "Goals I've set" tab to actually mount before probing its anchors.
    await screen.findByRole("tab", { name: "Goals I've set" });

    for (const target of [
      '[data-tour="goals-own"]',
      '[data-tour="goals-managed"]',
      '[data-tour="goals-filters"]',
      '[data-tour="goals-new"]',
      '[data-tour="goals-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
    // The two GoalTables are keepMounted={false} — only the active tab's Filters toggle renders.
    expect(document.querySelectorAll('[data-tour="goals-filters"]')).toHaveLength(1);
  });

  test("every create-form anchor mounts in picker mode", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreateGoalPicker();

    await screen.findByRole("heading", { name: "New goal" });

    for (const target of ['[data-tour="goals-definition"]', '[data-tour="goals-form-actions"]']) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(goalsPageHandler(1)(String(url))));
    renderGoalsHub("/goals?tab=managed");
    await screen.findByRole("tab", { name: "Goals I've set" });
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreateGoalPicker();
    await screen.findByRole("heading", { name: "New goal" });

    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
