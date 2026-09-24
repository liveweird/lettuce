import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import AppDatesProvider from "../components/AppDatesProvider";
import { buildSteps, TourContext } from "../components/tourSupport";
import { teamKpiCreateLink } from "../utils/teamKpiLinks";
import { TEAM_KPIS_TUTORIAL } from "./teamKpis";
import MyTeamKpis from "../pages/MyTeamKpis";
import CreateTeamKpi from "../pages/CreateTeamKpi";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea, exactly like CreateTeamKpi.test.tsx (the
// anchor smoke test below renders the real create form).
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };
// The create form's URL from the Team KPIs hub's own manager "New team KPI" entry point.
const FORM_URL = teamKpiCreateLink(undefined, "/team-kpis?tab=managed");

describe("TEAM_KPIS_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("7 steps for a non-manager, 14 for a manager — exactly the managerOnly targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(TEAM_KPIS_TUTORIAL.steps, t, false);
    const manager = buildSteps(TEAM_KPIS_TUTORIAL.steps, t, true);

    // The six DOM-anchored managerOnly steps ("lifecycleActions", the seventh, shares the "body"
    // target with the four non-managerOnly concept steps, so it can't be asserted the same way —
    // its presence is covered by the body-step count below instead).
    const managerOnlyTargets = [
      '[data-tour="team-kpis-managed"]',
      '[data-tour="team-kpis-managed-filters"]',
      '[data-tour="team-kpis-new"]',
      '[data-tour="team-kpis-definition"]',
      '[data-tour="team-kpis-form-actions"]',
      '[data-tour="dashboard-myTeams"]',
    ];
    expect(nonManager).toHaveLength(7);
    expect(manager).toHaveLength(14);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is shared by intro/lifecycle/data/graph (everyone) and lifecycleActions
    // (managerOnly): 4 vs 5.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(4);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(5);
  });

  test("a caller without TEAM_KPIS enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["TEAM_KPIS"]));
    const t = (k: string) => k;
    expect(buildSteps(TEAM_KPIS_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("the lifecycle step's render output contains the team KPI diagram", () => {
    const t = (k: string) => k;
    const [, lifecycleStep] = buildSteps(TEAM_KPIS_TUTORIAL.steps, t, true);
    render(
      <MantineProvider env="test">
        <>{lifecycleStep.content}</>
      </MantineProvider>,
    );
    expect(
      screen.getByRole("img", { name: "Diagram of the team KPI lifecycle" }),
    ).toBeInTheDocument();
    cleanup();
  });

  test("every step's before() hook navigates to its documented URL (exhaustive, index-paired table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const manager = buildSteps(TEAM_KPIS_TUTORIAL.steps, t, true, navigateTo, 7);

    // Exhaustive: every navTo-carrying step definition, in the def table's own order. "own" and
    // "end" deliberately share both target and destination — the shared last step re-spotlights
    // My teams' KPIs — so this is index-paired against the def list rather than looked up by
    // target (a target-keyed lookup couldn't tell the two apart; the impactLog precedent).
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="team-kpis-own"]', path: "/team-kpis?tab=own" },
      { target: '[data-tour="team-kpis-filters"]', path: "/team-kpis?tab=own" },
      { target: '[data-tour="team-kpis-managed"]', path: "/team-kpis?tab=managed" },
      { target: '[data-tour="team-kpis-managed-filters"]', path: "/team-kpis?tab=managed" },
      { target: '[data-tour="team-kpis-new"]', path: "/team-kpis?tab=managed" },
      { target: '[data-tour="team-kpis-definition"]', path: FORM_URL },
      { target: '[data-tour="team-kpis-form-actions"]', path: FORM_URL },
      { target: '[data-tour="dashboard-myTeams"]', path: "/?tab=myTeams" },
      { target: '[data-tour="team-kpis-own"]', path: "/team-kpis?tab=own" },
    ];
    const navDefs = TEAM_KPIS_TUTORIAL.steps.filter((s) => s.navTo);
    expect(cases.map((c) => c.target).sort()).toEqual(navDefs.map((s) => s.target).sort());
    expect(cases.map((c) => c.path).sort()).toEqual(navDefs.map((s) => s.navTo).sort());

    let caseIndex = 0;
    for (let i = 0; i < TEAM_KPIS_TUTORIAL.steps.length; i++) {
      const def = TEAM_KPIS_TUTORIAL.steps[i];
      if (!def.navTo) continue;
      const { target, path } = cases[caseIndex++];
      expect(def.target).toBe(target);
      await manager[i].before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The five concept steps (intro, lifecycle, data, graph, lifecycleActions) share the "body"
    // target and never navigate.
    navigateTo.mockClear();
    const bodySteps = manager.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(5);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the Team KPIs hub
// and the create form actually exists once those pages are rendered under realistic mocks (the
// goals.test.tsx/impactLog.test.tsx idiom). dashboard-myTeams lives on the Dashboard page — not
// on either page under test here, so it's out of scope for this smoke test.

function teamKpisPageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      const items =
        managerOfTeams > 0
          ? [{ id: 10, name: "Platform", managerId: 7, managerName: "Me", managerDeleted: false }]
          : [];
      return jsonResponse(200, { ...EMPTY_PAGE, items, total: managerOfTeams });
    }
    if (u.startsWith("/api/v1/team-kpis?")) return jsonResponse(200, EMPTY_PAGE);
    return jsonResponse(200, EMPTY_PAGE);
  };
}

// A no-op TourContext — MyTeamKpis' header TutorialButton needs one, and this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/MyTeamKpis.test.tsx).
function renderTeamKpisHub(route: string) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <AppDatesProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {}, launchTutorial: () => {} }}>
            <MemoryRouter initialEntries={[route]}>
              <MyTeamKpis />
            </MemoryRouter>
          </TourContext.Provider>
        </QueryClientProvider>
      </AppDatesProvider>
    </MantineProvider>,
  );
}

function renderCreateTeamKpiPicker() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/team-kpis/new"]}>
          <Routes>
            <Route path="/team-kpis/new" element={<CreateTeamKpi />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("team KPI tutorial anchors exist on the real pages", () => {
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

  test("every Team-KPIs-hub anchor mounts for a manager on the own tab", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(teamKpisPageHandler(1)(String(url))));
    renderTeamKpisHub("/team-kpis?tab=own");

    await screen.findByRole("tab", { name: "Managed KPIs" });

    for (const target of [
      '[data-tour="team-kpis-own"]',
      '[data-tour="team-kpis-filters"]',
      '[data-tour="team-kpis-new"]',
      '[data-tour="team-kpis-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("every managed-tab anchor mounts for a manager", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(teamKpisPageHandler(1)(String(url))));
    renderTeamKpisHub("/team-kpis?tab=managed");

    const managedTab = await screen.findByRole("tab", { name: "Managed KPIs" });
    expect(managedTab).toBeInTheDocument();

    for (const target of [
      '[data-tour="team-kpis-managed"]',
      '[data-tour="team-kpis-managed-filters"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
    // The two TeamKpiTables are keepMounted={false} — only the active tab's Filters toggle renders.
    expect(document.querySelectorAll('[data-tour="team-kpis-managed-filters"]')).toHaveLength(1);
  });

  test("every create-form anchor mounts in picker mode", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(teamKpisPageHandler(1)(String(url))));
    renderCreateTeamKpiPicker();

    await screen.findByRole("heading", { name: "New team KPI" });

    for (const target of ['[data-tour="team-kpis-definition"]', '[data-tour="team-kpis-form-actions"]']) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(teamKpisPageHandler(1)(String(url))));
    renderTeamKpisHub("/team-kpis?tab=managed");
    await screen.findByRole("tab", { name: "Managed KPIs" });
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(teamKpisPageHandler(1)(String(url))));
    renderCreateTeamKpiPicker();
    await screen.findByRole("heading", { name: "New team KPI" });

    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
