import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import AppDatesProvider from "../components/AppDatesProvider";
import { buildSteps, TourContext } from "../components/tourSupport";
import { reviewCreateLink } from "../utils/performanceReviewLinks";
import { PERFORMANCE_REVIEWS_TUTORIAL } from "./performanceReviews";
import { renderWithProviders } from "../test/render";
import Performance from "../pages/Performance";
import CreatePerformanceReview from "../pages/CreatePerformanceReview";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

describe("PERFORMANCE_REVIEWS_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("6 steps for a non-manager, 14 for a manager — exactly the managerOnly targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(PERFORMANCE_REVIEWS_TUTORIAL.steps, t, false);
    const manager = buildSteps(PERFORMANCE_REVIEWS_TUTORIAL.steps, t, true);

    // The seven DOM-anchored managerOnly steps (the eighth, "manage", shares the "body" target
    // with three non-managerOnly steps, so it can't be asserted the same way — its presence is
    // covered by the body-step count below instead).
    const managerOnlyTargets = [
      '[data-tour="performance-managed"]',
      '[data-tour="performance-period"]',
      '[data-tour="performance-view"]',
      '[data-tour="performance-dashboard-filters"]',
      '[data-tour="performance-dashboard"]',
      '[data-tour="performance-form"]',
      '[data-tour="performance-form-actions"]',
    ];
    expect(nonManager).toHaveLength(6);
    expect(manager).toHaveLength(14);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is shared by intro/lifecycle/categories (everyone) and manage (managerOnly): 3 vs 4.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(3);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(4);
  });

  test("a caller without PERFORMANCE_REVIEWS enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["PERFORMANCE_REVIEWS"]));
    const t = (k: string) => k;
    expect(buildSteps(PERFORMANCE_REVIEWS_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const steps = buildSteps(PERFORMANCE_REVIEWS_TUTORIAL.steps, t, true, navigateTo, 7);

    const formUrl = reviewCreateLink(undefined, "/performance?tab=managed");
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="performance-own"]', path: "/performance?tab=own" },
      { target: '[data-tour="performance-filters"]', path: "/performance?tab=own" },
      { target: '[data-tour="performance-managed"]', path: "/performance?tab=managed" },
      { target: '[data-tour="performance-period"]', path: "/performance?tab=managed" },
      { target: '[data-tour="performance-view"]', path: "/performance?tab=managed" },
      { target: '[data-tour="performance-dashboard-filters"]', path: "/performance?tab=managed" },
      { target: '[data-tour="performance-dashboard"]', path: "/performance?tab=managed" },
      { target: '[data-tour="performance-form"]', path: formUrl },
      { target: '[data-tour="performance-form-actions"]', path: formUrl },
      { target: '[data-tour="config-review-periods"]', path: "/review-periods" },
    ];
    // Exhaustive: every navTo-carrying step in the tutorial is covered above (the whirlwind
    // Tour.test.tsx idiom) — a newly added navigating step fails here until it is added.
    expect(cases.map((c) => c.target).sort()).toEqual(
      PERFORMANCE_REVIEWS_TUTORIAL.steps.filter((s) => s.navTo).map((s) => s.target).sort(),
    );
    for (const { target, path } of cases) {
      const step = steps.find((s) => s.target === target);
      expect(step, `missing step for ${path}`).toBeDefined();
      await step!.before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The four concept steps (intro, lifecycle, categories, manage) share the "body" target and
    // never navigate.
    navigateTo.mockClear();
    const bodySteps = steps.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(4);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test("the lifecycle step's render embeds ReviewLifecycle with no current status", () => {
    const step = PERFORMANCE_REVIEWS_TUTORIAL.steps.find(
      (s) => s.contentKey === "tutorials.performanceReviews.steps.lifecycle",
    );
    expect(step?.render).toBeDefined();
    renderWithProviders(<>{step!.render!("Lifecycle text")}</>);
    expect(screen.getByText("Lifecycle text")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
    // No `currentStatus` was passed — no node is highlighted.
    expect(document.querySelector('rect[fill="var(--mantine-primary-color-light)"]')).toBeNull();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the Performance
// hub and the create form actually exists once those pages are rendered under realistic mocks
// (the goals.test.tsx idiom, using Performance.test.tsx's mock shape). The dashboard anchors
// need at least one review period and one managed team member so the completion table renders
// instead of the empty-timeline EmptyState.

function performancePageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      const items =
        managerOfTeams > 0
          ? [{ id: 1, name: "Platform", managerId: 7, managerName: "Me", managerDeleted: false }]
          : [];
      return jsonResponse(200, { items, page: 1, pageSize: 1, total: managerOfTeams });
    }
    if (u.includes("/api/v1/review-periods")) {
      return jsonResponse(200, { items: [{ id: 1, startMonth: "2026-01", endMonth: "2026-06" }] });
    }
    if (u.startsWith("/api/v1/teams/members")) {
      return jsonResponse(200, {
        items: [{ userId: 8, name: "Sam Subordinate", email: "sam@example.com", teamId: 1, teamName: "alpha" }],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    }
    if (u.startsWith("/api/v1/performance-reviews?")) {
      return jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 });
    }
    return jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 });
  };
}

function pickerHandler(url: string): Response {
  const u = String(url);
  if (u.includes("/api/v1/review-periods")) {
    return jsonResponse(200, { items: [{ id: 1, startMonth: "2026-01", endMonth: "2026-06" }] });
  }
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

// A no-op TourContext — Performance's header TutorialButton needs one, and this suite pins the
// two pages' anchors rather than the launcher's own wiring (covered in pages/Performance.test.tsx).
// Both helpers assume `fetch` is already stubbed by the caller.
function renderPerformanceHub(route: string) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {}, launchTutorial: () => {} }}>
            <MemoryRouter initialEntries={[route]}>
              <Performance />
            </MemoryRouter>
          </TourContext.Provider>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

function renderCreatePerformanceReviewPicker() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/performance-reviews/new"]}>
          <Routes>
            <Route path="/performance-reviews/new" element={<CreatePerformanceReview />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("performance review tutorial anchors exist on the real pages", () => {
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

  test("the own-tab anchors mount for everyone", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(performancePageHandler(0)(String(url))));
    renderPerformanceHub("/performance?tab=own");

    await screen.findByRole("tab", { name: "My performance" });

    for (const target of [
      '[data-tour="performance-own"]',
      '[data-tour="performance-filters"]',
      '[data-tour="performance-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("every managed-tab dashboard anchor mounts for a manager, with a non-empty timeline", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(performancePageHandler(1)(String(url))));
    renderPerformanceHub("/performance?tab=managed");

    // Wait for the manager-only "Team's performance" tab to actually mount before probing its
    // anchors, and for the completion table (not the empty-timeline EmptyState) to render.
    await screen.findByRole("tab", { name: "Team's performance" });
    await screen.findByText("Sam Subordinate");

    for (const target of [
      '[data-tour="performance-managed"]',
      '[data-tour="performance-period"]',
      '[data-tour="performance-view"]',
      '[data-tour="performance-dashboard-filters"]',
      '[data-tour="performance-dashboard"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
    // Mantine 9.6 spreads unknown Select props onto the <input> — pinning wrapperProps keeps
    // the spotlight on the label+input pair, not a lone <input>.
    const periodAnchor = document.querySelector('[data-tour="performance-period"]');
    expect(periodAnchor?.tagName).not.toBe("INPUT");
  });

  test("every create-form anchor mounts in picker mode", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreatePerformanceReviewPicker();

    await screen.findByText("New review");

    for (const target of ['[data-tour="performance-form"]', '[data-tour="performance-form-actions"]']) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(performancePageHandler(1)(String(url))));
    renderPerformanceHub("/performance?tab=managed");
    await screen.findByText("Sam Subordinate");
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreatePerformanceReviewPicker();
    await screen.findByText("New review");

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(0));
    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
