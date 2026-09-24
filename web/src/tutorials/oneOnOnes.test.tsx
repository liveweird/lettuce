import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import AppDatesProvider from "../components/AppDatesProvider";
import { buildSteps, TourContext } from "../components/tourSupport";
import { ONE_ON_ONES_TUTORIAL } from "./oneOnOnes";
import OneOnOnes from "../pages/OneOnOnes";
import CreateOneOnOne from "../pages/CreateOneOnOne";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };
// The create form's URL from the hub header's own "New 1:1" entry point — oneOnOneCreateLink
// requires a subordinateId (no subordinate-less variant to reuse, unlike goals/reviews), so the
// tutorial spotlights this plain target instead.
const FORM_URL = "/one-on-ones/new";

describe("ONE_ON_ONES_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("6 steps for a non-manager, 13 for a manager — exactly the managerOnly targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(ONE_ON_ONES_TUTORIAL.steps, t, false);
    const manager = buildSteps(ONE_ON_ONES_TUTORIAL.steps, t, true);

    // The six DOM-anchored managerOnly steps ("edit" shares the "body" target with the
    // non-managerOnly concept steps, so it can't be asserted the same way — its presence is
    // covered by the body-step count below instead).
    const managerOnlyTargets = [
      '[data-tour="one-on-one-managed"]',
      '[data-tour="one-on-one-team"]',
      '[data-tour="one-on-one-new"]',
      '[data-tour="one-on-one-form"]',
      '[data-tour="one-on-one-form-actions"]',
      '[data-tour="dashboard-subordinates"]',
    ];
    expect(nonManager).toHaveLength(6);
    expect(manager).toHaveLength(13);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is shared by intro/document/carryOver (everyone) and edit (managerOnly): 3 vs 4.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(3);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(4);
  });

  test("a caller without ONE_ON_ONES enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["ONE_ON_ONES"]));
    const t = (k: string) => k;
    expect(buildSteps(ONE_ON_ONES_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const steps = buildSteps(ONE_ON_ONES_TUTORIAL.steps, t, true, navigateTo, 7);

    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="one-on-one-own"]', path: "/one-on-ones?tab=own" },
      { target: '[data-tour="one-on-one-filters"]', path: "/one-on-ones?tab=own" },
      { target: '[data-tour="one-on-one-managed"]', path: "/one-on-ones?tab=managed" },
      { target: '[data-tour="one-on-one-team"]', path: "/one-on-ones?tab=team" },
      { target: '[data-tour="one-on-one-new"]', path: "/one-on-ones?tab=managed" },
      { target: '[data-tour="one-on-one-form"]', path: FORM_URL },
      { target: '[data-tour="one-on-one-form-actions"]', path: FORM_URL },
      { target: '[data-tour="dashboard-subordinates"]', path: "/?tab=subordinates" },
      { target: '[data-tour="dashboard-managers"]', path: "/?tab=managers" },
    ];
    // Exhaustive: every navTo-carrying step in the tutorial is covered above (the whirlwind
    // Tour.test.tsx idiom) — a newly added navigating step fails here until it is added.
    expect(cases.map((c) => c.target).sort()).toEqual(
      ONE_ON_ONES_TUTORIAL.steps.filter((s) => s.navTo).map((s) => s.target).sort(),
    );
    for (const { target, path } of cases) {
      const step = steps.find((s) => s.target === target);
      expect(step, `missing step for ${path}`).toBeDefined();
      await step!.before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The four concept steps (intro, document, carryOver, edit) share the "body" target and
    // never navigate.
    navigateTo.mockClear();
    const bodySteps = steps.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(4);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the 1:1 hub and
// the create form actually exists once those pages are rendered under realistic mocks (the
// goals.test.tsx idiom, using OneOnOnes.test.tsx's mock shape).

function oneOnOnesPageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      return jsonResponse(200, { ...EMPTY_PAGE, total: managerOfTeams });
    }
    if (u.startsWith("/api/v1/one-on-ones?")) {
      return jsonResponse(200, EMPTY_PAGE);
    }
    return jsonResponse(200, EMPTY_PAGE);
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
  return jsonResponse(200, EMPTY_PAGE);
}

// A no-op TourContext — the hub header's TutorialButton needs one; this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/OneOnOnes.test.tsx).
// Both helpers assume `fetch` is already stubbed by the caller.
function renderOneOnOnesHub(route: string) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {}, launchTutorial: () => {} }}>
            <MemoryRouter initialEntries={[route]}>
              <OneOnOnes />
            </MemoryRouter>
          </TourContext.Provider>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

function renderCreateOneOnOnePicker() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/one-on-ones/new"]}>
          <Routes>
            <Route path="/one-on-ones/new" element={<CreateOneOnOne />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("1:1 meetings tutorial anchors exist on the real pages", () => {
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
    mockFetch.mockImplementation((url: string) => Promise.resolve(oneOnOnesPageHandler(0)(String(url))));
    renderOneOnOnesHub("/one-on-ones?tab=own");

    await screen.findByRole("tab", { name: "I'm a subordinate" });

    for (const target of [
      '[data-tour="one-on-one-own"]',
      '[data-tour="one-on-one-filters"]',
      '[data-tour="one-on-one-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("every managed-tab anchor mounts for a manager", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(oneOnOnesPageHandler(1)(String(url))));
    renderOneOnOnesHub("/one-on-ones?tab=managed");

    await screen.findByRole("tab", { name: "I'm a manager" });

    for (const target of [
      '[data-tour="one-on-one-managed"]',
      '[data-tour="one-on-one-team"]',
      '[data-tour="one-on-one-new"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("every create-form anchor mounts in picker mode", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreateOneOnOnePicker();

    await screen.findByRole("combobox", { name: "Team member" });

    for (const target of ['[data-tour="one-on-one-form"]', '[data-tour="one-on-one-form-actions"]']) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(oneOnOnesPageHandler(1)(String(url))));
    renderOneOnOnesHub("/one-on-ones?tab=managed");
    await screen.findByRole("tab", { name: "I'm a manager" });
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreateOneOnOnePicker();
    await screen.findByRole("combobox", { name: "Team member" });

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(0));
    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
