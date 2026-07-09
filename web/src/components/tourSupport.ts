// Non-component support for the guided tour (Tour.tsx): step definitions, seen-state persistence,
// contexts and the useTour hook. Kept out of Tour.tsx so that file only exports components and
// stays compatible with React Fast Refresh (react-refresh/only-export-components).
import { createContext, useContext } from "react";
// Types only — erased at build time. The runtime react-joyride import lives solely in
// TourJoyride.tsx, which Tour.tsx lazy-loads so the library stays out of the entry chunk.
import type { Step } from "react-joyride";

const SEEN_PREFIX = "lettuce.tour.seen.";
const seenKey = (userId: number) => `${SEEN_PREFIX}${userId}`;

/** Whether this account has already completed/dismissed the tour (once per user, not per browser). */
export function hasSeenTour(userId: number | null): boolean {
  return userId != null && localStorage.getItem(seenKey(userId)) === "1";
}

/** Persist that this account has completed/dismissed the tour. */
export function markSeen(userId: number | null) {
  if (userId != null) localStorage.setItem(seenKey(userId), "1");
}

type TourStepDef = {
  target: string;
  contentKey: string;
  placement?: Step["placement"];
  /** Shown only to callers who manage a team (the Feedback "My team" tab is manager-only). */
  managerOnly?: boolean;
  /** When set, navigate to this URL before the step is shown (e.g. switch a tab / open a route). */
  navTo?: string;
};

// Anchored to the always-present AppShell header + navbar, so every target is in the DOM and no
// cross-route navigation is needed. A missing/hidden target (e.g. a collapsed mobile navbar) is
// skipped by Joyride rather than breaking the tour.
export const TOUR_STEPS: TourStepDef[] = [
  { target: "body", contentKey: "tour.steps.welcome", placement: "center" },
  // Navigate to each lazy-loaded section a step early (on its nav step) so the route is mounted
  // before the subsection steps below need their targets — otherwise, starting the tour off that
  // section skips them. The nav tooltip still anchors on the always-present navbar link.
  { target: '[data-tour="nav-dashboard"]', contentKey: "tour.steps.dashboard", placement: "right", navTo: "/?tab=managers" },
  // The Dashboard's three subsections — each step switches the active tab (via `navTo`) so the
  // matching view is shown while the step is presented.
  { target: '[data-tour="dashboard-managers"]', contentKey: "tour.steps.dashboardManagers", placement: "bottom", navTo: "/?tab=managers" },
  { target: '[data-tour="dashboard-peers"]', contentKey: "tour.steps.dashboardPeers", placement: "bottom", navTo: "/?tab=peers" },
  { target: '[data-tour="dashboard-subordinates"]', contentKey: "tour.steps.dashboardSubordinates", placement: "bottom", navTo: "/?tab=subordinates" },
  { target: '[data-tour="nav-feedback"]', contentKey: "tour.steps.feedback", placement: "right", navTo: "/feedback?tab=received" },
  // The Feedback section's three subsections. "My team" is manager-only (matches the page).
  { target: '[data-tour="feedback-received"]', contentKey: "tour.steps.feedbackReceived", placement: "bottom", navTo: "/feedback?tab=received" },
  { target: '[data-tour="feedback-provided"]', contentKey: "tour.steps.feedbackProvided", placement: "bottom", navTo: "/feedback?tab=provided" },
  { target: '[data-tour="feedback-team"]', contentKey: "tour.steps.feedbackTeam", placement: "bottom", navTo: "/feedback?tab=team", managerOnly: true },
  // The Config section + its three subsections (separate routes). The nav step navigates into the
  // section a step early so the lazy /users route is mounted before its subsection target is needed.
  { target: '[data-tour="nav-config"]', contentKey: "tour.steps.config", placement: "right", navTo: "/users" },
  { target: '[data-tour="config-users"]', contentKey: "tour.steps.configUsers", placement: "bottom", navTo: "/users" },
  { target: '[data-tour="config-teams"]', contentKey: "tour.steps.configTeams", placement: "bottom", navTo: "/teams" },
  { target: '[data-tour="config-templates"]', contentKey: "tour.steps.configTemplates", placement: "bottom", navTo: "/templates" },
  { target: '[data-tour="notifications"]', contentKey: "tour.steps.notifications", placement: "bottom" },
  { target: '[data-tour="language"]', contentKey: "tour.steps.language", placement: "bottom" },
  { target: '[data-tour="theme"]', contentKey: "tour.steps.theme", placement: "bottom" },
  { target: '[data-tour="nav-change-password"]', contentKey: "tour.steps.account", placement: "right" },
  { target: '[data-tour="logout"]', contentKey: "tour.steps.logout", placement: "bottom" },
  { target: '[data-tour="replay"]', contentKey: "tour.steps.replay", placement: "bottom" },
];

/**
 * Resolve once an element matching `selector` is in the DOM, or after `timeoutMs` as a fallback.
 * Lets a step's `before` hook wait for a (possibly cold lazy-loaded) route's target to mount before
 * the tour shows the step. Exported for unit tests.
 */
export function waitForElement(selector: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (document.querySelector(selector) || Date.now() >= deadline) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

/** Build the audience-filtered, translated Joyride steps. Exported for unit tests. */
export function buildSteps(
  translate: (key: string, opts?: Record<string, unknown>) => string,
  manager: boolean,
  navigateTo?: (path: string, target?: string) => Promise<void> | void,
): Step[] {
  // The total is the audience-filtered count, so headers read "Step X of Y" against the steps this
  // caller will actually see.
  const defs = TOUR_STEPS.filter((s) => !s.managerOnly || manager);
  const total = defs.length;
  return defs.map((s, i) => ({
    target: s.target,
    title: translate("tour.stepCounter", { current: i + 1, total }),
    content: translate(s.contentKey),
    placement: s.placement,
    disableBeacon: true,
    // Steps with a `navTo` change the view (tab/route) before they show; the tour awaits this hook,
    // which navigates and then waits for the step's target to actually mount (cold lazy routes).
    ...(s.navTo && navigateTo
      ? { before: async () => { await navigateTo(s.navTo!, s.target); } }
      : {}),
  }));
}

type TourContextValue = { startTour: () => void };
export const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within a TourProvider");
  return ctx;
}

// Provider-level actions the custom tooltip needs but Joyride's render props don't expose. Joyride
// renders the tooltip into a portal, but React context still flows through portals, so the tooltip
// (mounted under TourProvider) can read this.
type TourActions = { abandon: () => void };
// Exported for unit tests (so a test can supply a spy `abandon`).
export const TourActionsContext = createContext<TourActions | null>(null);
