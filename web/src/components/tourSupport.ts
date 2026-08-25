// Non-component support for the guided tour (Tour.tsx): step definitions, seen-state persistence,
// contexts and the useTour hook. Kept out of Tour.tsx so that file only exports components and
// stays compatible with React Fast Refresh (react-refresh/only-export-components).
import type { ParseKeys } from "i18next";
import { createContext, useContext } from "react";
// Types only — erased at build time. The runtime react-joyride import lives solely in
// TourJoyride.tsx, which Tour.tsx lazy-loads so the library stays out of the entry chunk.
import type { Step } from "react-joyride";
import { hasFeature, isAdmin, isHr, type Feature } from "../api/session";

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
  contentKey: ParseKeys;
  placement?: Step["placement"];
  /** Shown only to callers who manage a team (e.g. the Feedback "My team" tab and the 1:1
   *  "I'm a manager" / "My subordinate's a manager" tabs are manager-only). */
  managerOnly?: boolean;
  /** Shown to managers OR the HR auditor — the Pulse "participation" tab's own gate
   *  (`canMonitor` in pages/Pulse.tsx), which is wider than `managerOnly`. */
  managerOrHr?: boolean;
  /** Shown only to an ADMIN — the three Config leaves the navbar itself appends admin-only
   *  (Pulse cycles, Feature flags, Alerts). */
  adminOnly?: boolean;
  /** Shown only while the caller has this feature enabled (v1.53.0) — the step's anchor
   *  (nav link / tab) is gone when the flag is off, so the step must go with it. */
  feature?: Feature;
  /** When set, navigate to this URL before the step is shown (e.g. switch a tab / open a route).
   *  A literal `:userId` segment is replaced with the caller's id by buildSteps. */
  navTo?: string;
};

// Anchored to the always-present AppShell header + navbar, so every target is in the DOM and no
// cross-route navigation is needed. A missing/hidden target (e.g. a collapsed mobile navbar) is
// skipped by Joyride rather than breaking the tour.
// Scrolling contract: every target must sit in fixed chrome (header/navbar) or at the very top of
// a page's content (tab bar, page title). buildSteps pins the window scroll to the top on every
// step and disables Joyride's own scrolling (which would pull a page title halfway under the fixed
// header) — a below-the-fold target would therefore end up off-screen.
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
  { target: '[data-tour="dashboard-myTeams"]', contentKey: "tour.steps.dashboardMyTeams", placement: "bottom", navTo: "/?tab=myTeams" },
  { target: '[data-tour="nav-feedback"]', contentKey: "tour.steps.feedback", placement: "right", navTo: "/feedback?tab=received" , feature: "FEEDBACKS" },
  // The Feedback section's three subsections. "My team" is manager-only (matches the page).
  { target: '[data-tour="feedback-received"]', contentKey: "tour.steps.feedbackReceived", placement: "bottom", navTo: "/feedback?tab=received" , feature: "FEEDBACKS" },
  { target: '[data-tour="feedback-provided"]', contentKey: "tour.steps.feedbackProvided", placement: "bottom", navTo: "/feedback?tab=provided" , feature: "FEEDBACKS" },
  { target: '[data-tour="feedback-team"]', contentKey: "tour.steps.feedbackTeam", placement: "bottom", navTo: "/feedback?tab=team", managerOnly: true , feature: "FEEDBACKS" },
  // Kudos — the org-wide wall of PUBLIC+SENT feedback (v2.2.0); part of the FEEDBACKS area.
  { target: '[data-tour="nav-kudos"]', contentKey: "tour.steps.kudos", placement: "right", navTo: "/kudos" , feature: "FEEDBACKS" },
  // The 1:1 meetings section + its tabs, toured in the page's visual order (managed | own | team);
  // "managed"/"team" are manager-only (matches the page). The nav step's ?tab=managed is safe for
  // non-managers: the page's activeTab logic falls back to "own", which is their next step anyway.
  { target: '[data-tour="nav-one-on-ones"]', contentKey: "tour.steps.oneOnOnes", placement: "right", navTo: "/one-on-ones?tab=managed" , feature: "ONE_ON_ONES" },
  { target: '[data-tour="one-on-one-managed"]', contentKey: "tour.steps.oneOnOneManaged", placement: "bottom", navTo: "/one-on-ones?tab=managed", managerOnly: true , feature: "ONE_ON_ONES" },
  { target: '[data-tour="one-on-one-own"]', contentKey: "tour.steps.oneOnOneOwn", placement: "bottom", navTo: "/one-on-ones?tab=own" , feature: "ONE_ON_ONES" },
  { target: '[data-tour="one-on-one-team"]', contentKey: "tour.steps.oneOnOneTeam", placement: "bottom", navTo: "/one-on-ones?tab=team", managerOnly: true , feature: "ONE_ON_ONES" },
  // Goals — every user has the page (their own goals; managers get a second tab), so no audience
  // gate on the nav step; it navigates into /goals so the tab headers below are mounted.
  { target: '[data-tour="nav-my-goals"]', contentKey: "tour.steps.myGoals", placement: "right", navTo: "/goals" , feature: "GOALS" },
  { target: '[data-tour="goals-own"]', contentKey: "tour.steps.goalsOwn", placement: "bottom", navTo: "/goals?tab=own" , feature: "GOALS" },
  // The managed tab header only mounts for managers — the gate keeps waitForElement from
  // burning its timeout on a target that never appears.
  { target: '[data-tour="goals-managed"]', contentKey: "tour.steps.goalsManaged", placement: "bottom", navTo: "/goals?tab=managed", managerOnly: true , feature: "GOALS" },
  // Impact log — the personal accomplishment journal (v2.36.0, the Self-reflection successor).
  { target: '[data-tour="nav-impact-log"]', contentKey: "tour.steps.impactLog", placement: "right", navTo: "/impact-log" , feature: "IMPACT_LOG" },
  // Team KPIs — the same shape as Goals: everyone has the member view, managers a second tab.
  { target: '[data-tour="nav-team-kpis"]', contentKey: "tour.steps.teamKpis", placement: "right", navTo: "/team-kpis" , feature: "TEAM_KPIS" },
  { target: '[data-tour="team-kpis-own"]', contentKey: "tour.steps.teamKpisOwn", placement: "bottom", navTo: "/team-kpis?tab=own" , feature: "TEAM_KPIS" },
  { target: '[data-tour="team-kpis-managed"]', contentKey: "tour.steps.teamKpisManaged", placement: "bottom", navTo: "/team-kpis?tab=managed", managerOnly: true , feature: "TEAM_KPIS" },
  // Performance — the Goals shape (v1.45.0): everyone has the own view, managers a second tab
  // with the per-period completion dashboard (formerly the Dashboard's reviews tab).
  { target: '[data-tour="nav-performance"]', contentKey: "tour.steps.performance", placement: "right", navTo: "/performance?tab=own" , feature: "PERFORMANCE_REVIEWS" },
  { target: '[data-tour="performance-own"]', contentKey: "tour.steps.performanceOwn", placement: "bottom", navTo: "/performance?tab=own" , feature: "PERFORMANCE_REVIEWS" },
  { target: '[data-tour="performance-managed"]', contentKey: "tour.steps.performanceManaged", placement: "bottom", navTo: "/performance?tab=managed", managerOnly: true , feature: "PERFORMANCE_REVIEWS" },
  // The career area is feature-UNGATED (v2.16.0) — no `feature` on any of its steps.
  { target: '[data-tour="nav-career"]', contentKey: "tour.steps.career", placement: "right", navTo: "/career?tab=my" },
  { target: '[data-tour="career-my"]', contentKey: "tour.steps.careerMy", placement: "bottom", navTo: "/career?tab=my" },
  { target: '[data-tour="career-pyramid"]', contentKey: "tour.steps.careerPyramid", placement: "bottom", navTo: "/career?tab=pyramid", managerOnly: true },
  // Days off — every user has the calendar + own requests (v1.42.0), so only "team" is gated.
  { target: '[data-tour="nav-days-off"]', contentKey: "tour.steps.daysOff", placement: "right", navTo: "/days-off" , feature: "DAYS_OFF" },
  { target: '[data-tour="days-off-calendar"]', contentKey: "tour.steps.daysOffCalendar", placement: "bottom", navTo: "/days-off?tab=calendar" , feature: "DAYS_OFF" },
  { target: '[data-tour="days-off-requests"]', contentKey: "tour.steps.daysOffRequests", placement: "bottom", navTo: "/days-off?tab=requests" , feature: "DAYS_OFF" },
  { target: '[data-tour="days-off-team"]', contentKey: "tour.steps.daysOffTeam", placement: "bottom", navTo: "/days-off?tab=team", managerOnly: true , feature: "DAYS_OFF" },
  // Pulse — survey + results are everyone's; "participation" is the monitoring tab, which the page
  // shows to managers OR the HR auditor (`canMonitor`), hence the wider managerOrHr gate.
  { target: '[data-tour="nav-pulse"]', contentKey: "tour.steps.pulse", placement: "right", navTo: "/pulse", feature: "PULSE_SURVEYS" },
  { target: '[data-tour="pulse-survey"]', contentKey: "tour.steps.pulseSurvey", placement: "bottom", navTo: "/pulse?tab=survey", feature: "PULSE_SURVEYS" },
  { target: '[data-tour="pulse-results"]', contentKey: "tour.steps.pulseResults", placement: "bottom", navTo: "/pulse?tab=results", feature: "PULSE_SURVEYS" },
  { target: '[data-tour="pulse-trend"]', contentKey: "tour.steps.pulseTrend", placement: "bottom", navTo: "/pulse?tab=trend", feature: "PULSE_SURVEYS" },
  { target: '[data-tour="pulse-participation"]', contentKey: "tour.steps.pulseParticipation", placement: "bottom", navTo: "/pulse?tab=participation", managerOrHr: true, feature: "PULSE_SURVEYS" },
  // Succession plans — a manager's tool (v2.42.0): the nav leaf itself is manager-gated, so
  // the step carries the same gate.
  { target: '[data-tour="nav-succession"]', contentKey: "tour.steps.succession", placement: "right", navTo: "/succession", managerOnly: true, feature: "SUCCESSION_PLANS" },
  // The Config section + its subsections (separate routes). The nav step navigates into the
  // section a step early so the lazy /users route is mounted before its subsection target is needed.
  // Each leaf step anchors on that screen's page title, not on the navbar leaf.
  { target: '[data-tour="nav-config"]', contentKey: "tour.steps.config", placement: "right", navTo: "/users" },
  { target: '[data-tour="config-users"]', contentKey: "tour.steps.configUsers", placement: "bottom", navTo: "/users" },
  { target: '[data-tour="config-teams"]', contentKey: "tour.steps.configTeams", placement: "bottom", navTo: "/teams" },
  { target: '[data-tour="config-org"]', contentKey: "tour.steps.configOrg", placement: "bottom", navTo: "/org" },
  { target: '[data-tour="config-templates"]', contentKey: "tour.steps.configTemplates", placement: "bottom", navTo: "/templates" },
  // The two registries: readable by everyone, editable by ADMIN — so they follow the nav leaves'
  // feature gate only (the pages themselves render read-only for non-admins).
  { target: '[data-tour="config-review-periods"]', contentKey: "tour.steps.configReviewPeriods", placement: "bottom", navTo: "/review-periods" , feature: "PERFORMANCE_REVIEWS" },
  { target: '[data-tour="config-public-holidays"]', contentKey: "tour.steps.configPublicHolidays", placement: "bottom", navTo: "/public-holidays" , feature: "DAYS_OFF" },
  // The three admin-only Config leaves — the navbar appends them for ADMIN alone, so the steps
  // carry the same gate or waitForElement would burn its timeout on a target that never mounts.
  { target: '[data-tour="config-pulse-cycles"]', contentKey: "tour.steps.configPulseCycles", placement: "bottom", navTo: "/pulse-cycles", adminOnly: true, feature: "PULSE_SURVEYS" },
  { target: '[data-tour="config-feature-flags"]', contentKey: "tour.steps.configFeatureFlags", placement: "bottom", navTo: "/feature-flags", adminOnly: true },
  { target: '[data-tour="config-alerts"]', contentKey: "tour.steps.configAlerts", placement: "bottom", navTo: "/alerts", adminOnly: true },
  // Dictionaries gets ONE group-level step (nav-anchored, the nav-config idiom) covering all four
  // lists — they are the same editor over different vocabularies, so four leaf steps would repeat.
  { target: '[data-tour="nav-dictionaries"]', contentKey: "tour.steps.dictionaries", placement: "right", navTo: "/dictionaries/career-paths" },
  // The remaining left-menu leaves — each anchors on the navbar leaf but also opens the actual
  // screen behind it. The whole left menu is toured before the header icons below.
  { target: '[data-tour="nav-change-password"]', contentKey: "tour.steps.account", placement: "right", navTo: "/users/:userId/change-password" },
  // Email notifications lives only in the header account menu (no navbar leaf), so its step
  // anchors on the opened screen's page title instead — the config-leaf idiom.
  { target: '[data-tour="account-email-notifications"]', contentKey: "tour.steps.emailNotifications", placement: "bottom", navTo: "/users/:userId/email-notifications" },
  // Opening /changelog marks the "what's new" dot as seen — coherent: the user just saw it.
  { target: '[data-tour="nav-changelog"]', contentKey: "tour.steps.changelog", placement: "right", navTo: "/changelog" },
  // The header chrome, left to right.
  { target: '[data-tour="notifications"]', contentKey: "tour.steps.notifications", placement: "bottom" },
  { target: '[data-tour="language"]', contentKey: "tour.steps.language", placement: "bottom" },
  { target: '[data-tour="theme"]', contentKey: "tour.steps.theme", placement: "bottom" },
  { target: '[data-tour="user-menu"]', contentKey: "tour.steps.logout", placement: "bottom" },
  // The closing step returns home, so the tour doesn't park the user on the changelog page.
  { target: '[data-tour="replay"]', contentKey: "tour.steps.replay", placement: "bottom", navTo: "/" },
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
  translate: (key: ParseKeys, opts?: Record<string, unknown>) => string,
  manager: boolean,
  navigateTo?: (path: string, target?: string) => Promise<void> | void,
  userId?: number | null,
): Step[] {
  // The total is the audience-filtered count, so headers read "Step X of Y" against the steps this
  // caller will actually see.
  // Roles come straight from the stored session (the `hasFeature` idiom — a render-time read, not
  // reactive), so the caller-relative `manager` flag stays the only argument buildSteps needs.
  const defs = TOUR_STEPS.filter(
    (s) =>
      (!s.managerOnly || manager) &&
      (!s.managerOrHr || manager || isHr()) &&
      (!s.adminOnly || isAdmin()) &&
      (!s.feature || hasFeature(s.feature)),
  );
  const total = defs.length;
  // A per-user navTo (`:userId`) is unresolvable without a caller id — degrade to not navigating
  // (defensive only; the tour never runs unauthenticated).
  const resolveNavTo = (navTo: string): string | undefined =>
    navTo.includes(":userId")
      ? userId != null
        ? navTo.replace(":userId", String(userId))
        : undefined
      : navTo;
  return defs.map((s, i) => ({
    target: s.target,
    title: translate("tour.stepCounter", { current: i + 1, total }),
    content: translate(s.contentKey),
    placement: s.placement,
    disableBeacon: true,
    // Joyride's own scrolling is disabled: it aligns targets ~20px from the viewport top, which
    // drags page titles halfway under the fixed AppShell header. No target needs scrolling (see
    // the contract above) — instead every step resets the scroll itself in its `before` hook.
    skipScroll: true,
    // Steps with a `navTo` change the view (tab/route) before they show; the tour awaits this
    // hook, which navigates and then waits for the step's target to actually mount (cold lazy
    // routes). Every step then pins the window to the top, clearing residue from Joyride-scrolled
    // pre-fix sessions or a replay started mid-scroll.
    before: async () => {
      const navTo = s.navTo && resolveNavTo(s.navTo);
      if (navTo && navigateTo) await navigateTo(navTo, s.target);
      window.scrollTo({ top: 0 });
    },
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
