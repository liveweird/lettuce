import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { buildSteps, TourContext } from "../components/tourSupport";
import { IMPACT_LOG_TUTORIAL } from "./impactLog";
import ImpactLog from "../pages/ImpactLog";
import CreateImpactEntry from "../pages/CreateImpactEntry";
import { jsonResponse } from "../test/http";
import { impactEntryCreateLink } from "../utils/impactLogLinks";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };
// The create form's URL from the hub header's own "New entry" entry point.
const FORM_URL = impactEntryCreateLink("/impact-log?tab=own");

describe("IMPACT_LOG_TUTORIAL step list", () => {
  afterEach(() => {
    localStorage.removeItem(DISABLED_FEATURES_KEY);
  });

  test("9 steps for a non-manager, 12 for a manager — exactly the managerOnly targets widen it", () => {
    const t = (k: string) => k;
    const nonManager = buildSteps(IMPACT_LOG_TUTORIAL.steps, t, false);
    const manager = buildSteps(IMPACT_LOG_TUTORIAL.steps, t, true);

    const managerOnlyTargets = [
      '[data-tour="impact-log-managed"]',
      '[data-tour="impact-log-managed-filters"]',
      '[data-tour="dashboard-subordinates"]',
    ];
    expect(nonManager).toHaveLength(9);
    expect(manager).toHaveLength(12);
    for (const target of managerOnlyTargets) {
      expect(nonManager.some((s) => s.target === target), target).toBe(false);
      expect(manager.some((s) => s.target === target), target).toBe(true);
    }
    // "body" is shared by intro/sections (everyone) — 2 in both roles, since every
    // managerOnly step has its own DOM anchor.
    expect(nonManager.filter((s) => s.target === "body")).toHaveLength(2);
    expect(manager.filter((s) => s.target === "body")).toHaveLength(2);
  });

  test("a caller without IMPACT_LOG enabled sees no steps at all", () => {
    localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(["IMPACT_LOG"]));
    const t = (k: string) => k;
    expect(buildSteps(IMPACT_LOG_TUTORIAL.steps, t, true)).toHaveLength(0);
  });

  test("every step's before() hook navigates to its documented URL (exhaustive table)", async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const t = (k: string) => k;
    const manager = buildSteps(IMPACT_LOG_TUTORIAL.steps, t, true, navigateTo, 7);

    // Exhaustive: every navTo-carrying step definition, in the def table's own order. "own" and
    // "entry" deliberately share both target and destination — the closing step re-spotlights
    // My journal — so this is index-paired against the def list rather than looked up by
    // target (a target-keyed lookup couldn't tell the two apart).
    const cases: { target: string; path: string }[] = [
      { target: '[data-tour="impact-log-own"]', path: "/impact-log?tab=own" },
      { target: '[data-tour="impact-log-filters"]', path: "/impact-log?tab=own" },
      { target: '[data-tour="impact-log-new"]', path: "/impact-log?tab=own" },
      { target: '[data-tour="impact-log-form-header"]', path: FORM_URL },
      { target: '[data-tour="impact-log-form-steps"]', path: FORM_URL },
      { target: '[data-tour="impact-log-form-actions"]', path: FORM_URL },
      { target: '[data-tour="impact-log-managed"]', path: "/impact-log?tab=managed" },
      { target: '[data-tour="impact-log-managed-filters"]', path: "/impact-log?tab=managed" },
      { target: '[data-tour="dashboard-subordinates"]', path: "/?tab=subordinates" },
      { target: '[data-tour="impact-log-own"]', path: "/impact-log?tab=own" },
    ];
    const navDefs = IMPACT_LOG_TUTORIAL.steps.filter((s) => s.navTo);
    expect(cases.map((c) => c.target).sort()).toEqual(navDefs.map((s) => s.target).sort());
    expect(cases.map((c) => c.path).sort()).toEqual(navDefs.map((s) => s.navTo).sort());

    let caseIndex = 0;
    for (let i = 0; i < IMPACT_LOG_TUTORIAL.steps.length; i++) {
      const def = IMPACT_LOG_TUTORIAL.steps[i];
      if (!def.navTo) continue;
      const { target, path } = cases[caseIndex++];
      expect(def.target).toBe(target);
      await manager[i].before!({} as never);
      expect(navigateTo).toHaveBeenCalledWith(path, target);
    }
    expect(navigateTo).toHaveBeenCalledTimes(cases.length);

    // The two concept steps (intro, sections) share the "body" target and never navigate.
    navigateTo.mockClear();
    const bodySteps = manager.filter((s) => s.target === "body");
    expect(bodySteps).toHaveLength(2);
    for (const step of bodySteps) await step.before!({} as never);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

// --- Anchor smoke test: every non-body DOM target this tutorial spotlights on the impact log
// hub and the create form actually exists once those pages are rendered under realistic mocks
// (the oneOnOnes.test.tsx idiom, using ImpactLog.test.tsx's mock shape).

function impactLogPageHandler(managerOfTeams: number) {
  return (url: string): Response => {
    const u = String(url);
    if (u.startsWith("/api/v1/teams?")) {
      return jsonResponse(200, { ...EMPTY_PAGE, total: managerOfTeams });
    }
    if (u.startsWith("/api/v1/impact-log?")) {
      return jsonResponse(200, EMPTY_PAGE);
    }
    return jsonResponse(200, EMPTY_PAGE);
  };
}

// A no-op TourContext — the hub header's TutorialButton needs one; this suite pins the two
// pages' anchors rather than the launcher's own wiring (covered in pages/ImpactLog.test.tsx).
function renderImpactLogHub(route: string) {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TourContext.Provider value={{ startTour: () => {}, startTutorial: () => {} }}>
          <MemoryRouter initialEntries={[route]}>
            <ImpactLog />
          </MemoryRouter>
        </TourContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

function renderCreateImpactEntry() {
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/impact-log/new"]}>
          <Routes>
            <Route path="/impact-log/new" element={<CreateImpactEntry />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("impact log tutorial anchors exist on the real pages", () => {
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
    mockFetch.mockImplementation((url: string) => Promise.resolve(impactLogPageHandler(0)(String(url))));
    renderImpactLogHub("/impact-log?tab=own");

    await screen.findByRole("tab", { name: "My journal" });

    for (const target of [
      '[data-tour="impact-log-own"]',
      '[data-tour="impact-log-filters"]',
      '[data-tour="impact-log-new"]',
      '[data-tour="impact-log-tutorial"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("every managed-tab anchor mounts for a manager", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(impactLogPageHandler(1)(String(url))));
    renderImpactLogHub("/impact-log?tab=managed");

    await screen.findByRole("tab", { name: "My subordinates' journals" });

    for (const target of [
      '[data-tour="impact-log-managed"]',
      '[data-tour="impact-log-managed-filters"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("every create-form anchor mounts", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(impactLogPageHandler(0)(String(url))));
    renderCreateImpactEntry();

    await screen.findByLabelText(/^Title/);

    for (const target of [
      '[data-tour="impact-log-form-header"]',
      '[data-tour="impact-log-form-steps"]',
      '[data-tour="impact-log-form-actions"]',
    ]) {
      expect(document.querySelector(target), target).not.toBeNull();
    }
  });

  test("neither render ever mutates — every request the tutorial's pages issue is method-less or GET", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(impactLogPageHandler(1)(String(url))));
    renderImpactLogHub("/impact-log?tab=managed");
    await screen.findByRole("tab", { name: "My subordinates' journals" });
    cleanup();

    mockFetch.mockImplementation((url: string) => Promise.resolve(impactLogPageHandler(0)(String(url))));
    renderCreateImpactEntry();
    await screen.findByLabelText(/^Title/);

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(0));
    for (const [, init] of mockFetch.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method == null || method === "GET", `unexpected method: ${method}`).toBe(true);
    }
  });
});
