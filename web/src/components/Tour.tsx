import { createContext, useContext, useState, type ReactNode } from "react";
import { Joyride, STATUS, type Controls, type EventData, type Step } from "react-joyride";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUserId, listTeams } from "../api/client";

const SEEN_PREFIX = "lettuce.tour.seen.";
const seenKey = (userId: number) => `${SEEN_PREFIX}${userId}`;

/** Whether this account has already completed/dismissed the tour (once per user, not per browser). */
export function hasSeenTour(userId: number | null): boolean {
  return userId != null && localStorage.getItem(seenKey(userId)) === "1";
}
function markSeen(userId: number | null) {
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
const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within a TourProvider");
  return ctx;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const userId = getUserId();
  // Whether the caller manages a team — gates the Feedback "My team" subsection step. Shares the
  // Feedback page's query cache key so it dedupes.
  const { data: managedTeams } = useQuery({
    queryKey: ["managedTeams", userId],
    queryFn: () => listTeams({ page: 1, pageSize: 1, managerId: userId! }),
    enabled: userId !== null,
  });
  const isManager = (managedTeams?.total ?? 0) > 0;
  // A step's `navTo` switches the view before it shows — the target pages derive their state from
  // the URL. Wait for the step's target to mount before resolving so Joyride never tries to show a
  // step whose (possibly cold lazy-loaded) target isn't there yet.
  const navigateTo = (path: string, target?: string) =>
    new Promise<void>((resolve) => {
      navigate(path);
      if (target) void waitForElement(target).then(resolve);
      else setTimeout(resolve, 0);
    });
  const steps = buildSteps((k, o) => t(k, o), isManager, navigateTo);

  // Auto-start once per account: run on mount when authenticated and not yet seen.
  const [run, setRun] = useState(() => userId != null && !hasSeenTour(userId));
  // Bumped on Replay so Joyride remounts and restarts from the first step.
  const [tourKey, setTourKey] = useState(0);

  function startTour() {
    setTourKey((k) => k + 1);
    setRun(true);
  }

  function handleEvent(_data: EventData, controls: Controls) {
    const { status } = controls.info();
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      markSeen(userId);
    }
  }

  return (
    <TourContext.Provider value={{ startTour }}>
      {children}
      <Joyride
        key={tourKey}
        steps={steps}
        run={run}
        continuous
        scrollToFirstStep
        onEvent={handleEvent}
        options={{ zIndex: 10000 }}
        locale={{
          back: t("tour.nav.back"),
          close: t("tour.nav.close"),
          last: t("tour.nav.last"),
          next: t("tour.nav.next"),
          skip: t("tour.nav.skip"),
        }}
      />
    </TourContext.Provider>
  );
}
