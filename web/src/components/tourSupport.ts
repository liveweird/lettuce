// Non-component support for the guided tour (Tour.tsx): step definitions, seen-state persistence,
// contexts and the useTour hook. Kept out of Tour.tsx so that file only exports components and
// stays compatible with React Fast Refresh (react-refresh/only-export-components).
import type { ParseKeys } from "i18next";
import { createContext, useContext, type ReactNode } from "react";
// Types only — erased at build time. The runtime react-joyride import lives solely in
// TourJoyride.tsx, which Tour.tsx lazy-loads so the library stays out of the entry chunk.
import type { Step } from "react-joyride";
import { hasFeature, isAdmin, isHr, type Feature } from "../api/session";
// Type-only — erased at build time (verbatimModuleSyntax), so this doesn't create a runtime
// cycle even though tutorials/types.ts itself imports TourStepDef from this module.
import type { TutorialId } from "../tutorials/types";

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

export type TourStepDef = {
  target: string;
  contentKey: ParseKeys;
  placement?: Step["placement"];
  /** Rich tooltip content for a concept step (the feedback tutorial's lifecycle diagram) —
   *  `text` is the translated `contentKey`, which stays required as the plain-text fallback
   *  and the e2e landmark. Omitted for ordinary text steps. */
  render?: (text: string) => ReactNode;
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
// cross-route navigation is needed — since v3.23.0 no whirlwind step carries a `navTo` at all: the
// tour only briefly presents the menu (one stop per left-nav leaf/group, in navbar order) and the
// header icons, never opens a page. Feature depth lives in the per-feature tutorials
// (`tutorials/*.tsx`), launched from each hub's "How … works" button. A missing/hidden target
// (e.g. a collapsed mobile navbar) is skipped by Joyride rather than breaking the tour.
// Scrolling contract: every target must sit in fixed chrome (header/navbar) or at the very top of
// a page's content (tab bar, page title). buildSteps pins the window scroll to the top on every
// step and disables Joyride's own scrolling (which would pull a page title halfway under the fixed
// header) — a below-the-fold target would therefore end up off-screen.
export const TOUR_STEPS: TourStepDef[] = [
  { target: "body", contentKey: "tour.steps.welcome", placement: "center" },
  // The navbar, top to bottom: Overview, My work, Team, Administration, then the footer leaves —
  // one stop per leaf/group, each carrying exactly the gate the nav leaf itself carries
  // (`navModel.ts`). Config and Dictionaries get one group-level stop each (their leaves are
  // named in the stop's own copy, not toured individually).
  { target: '[data-tour="nav-dashboard"]', contentKey: "tour.steps.dashboard", placement: "right" },
  { target: '[data-tour="nav-kudos"]', contentKey: "tour.steps.kudos", placement: "right", feature: "FEEDBACKS" },
  { target: '[data-tour="nav-feedback"]', contentKey: "tour.steps.feedback", placement: "right", feature: "FEEDBACKS" },
  { target: '[data-tour="nav-one-on-ones"]', contentKey: "tour.steps.oneOnOnes", placement: "right", feature: "ONE_ON_ONES" },
  { target: '[data-tour="nav-my-goals"]', contentKey: "tour.steps.myGoals", placement: "right", feature: "GOALS" },
  { target: '[data-tour="nav-impact-log"]', contentKey: "tour.steps.impactLog", placement: "right", feature: "IMPACT_LOG" },
  // The career area is feature-UNGATED (v2.16.0) — no `feature` on its step.
  { target: '[data-tour="nav-career"]', contentKey: "tour.steps.career", placement: "right" },
  { target: '[data-tour="nav-days-off"]', contentKey: "tour.steps.daysOff", placement: "right", feature: "DAYS_OFF" },
  { target: '[data-tour="nav-team-kpis"]', contentKey: "tour.steps.teamKpis", placement: "right", feature: "TEAM_KPIS" },
  { target: '[data-tour="nav-performance"]', contentKey: "tour.steps.performance", placement: "right", feature: "PERFORMANCE_REVIEWS" },
  { target: '[data-tour="nav-pulse"]', contentKey: "tour.steps.pulse", placement: "right", feature: "PULSE_SURVEYS" },
  // Succession plans — a manager's tool (v2.42.0): the nav leaf itself is manager-gated, so
  // the step carries the same gate.
  { target: '[data-tour="nav-succession"]', contentKey: "tour.steps.succession", placement: "right", managerOnly: true, feature: "SUCCESSION_PLANS" },
  { target: '[data-tour="nav-config"]', contentKey: "tour.steps.config", placement: "right" },
  { target: '[data-tour="nav-dictionaries"]', contentKey: "tour.steps.dictionaries", placement: "right" },
  { target: '[data-tour="nav-change-password"]', contentKey: "tour.steps.account", placement: "right" },
  // Opening /changelog would mark the "what's new" dot as seen — the whirlwind never navigates,
  // so this stop just names the leaf, coherently (nothing is marked seen by looking at it).
  { target: '[data-tour="nav-changelog"]', contentKey: "tour.steps.changelog", placement: "right" },
  // The header chrome, left to right.
  { target: '[data-tour="notifications"]', contentKey: "tour.steps.notifications", placement: "bottom" },
  { target: '[data-tour="language"]', contentKey: "tour.steps.language", placement: "bottom" },
  { target: '[data-tour="theme"]', contentKey: "tour.steps.theme", placement: "bottom" },
  { target: '[data-tour="user-menu"]', contentKey: "tour.steps.logout", placement: "bottom" },
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

/** Applied to every tutorial step (never the whirlwind's `TOUR_STEPS`): react-joyride 3.2.0
 *  leaves the spotlighted element clickable by default (`blockTargetInteraction: false`,
 *  `node_modules/react-joyride/src/defaults.ts` — `Overlay.tsx` sets `pointerEvents: 'auto'`
 *  whenever it is false) and dismisses on either an overlay click or Escape. A tutorial never
 *  clicks real data and never lets the caller wander off-script, so every tutorial step blocks
 *  target interaction and both dismiss paths — the "a tutorial never clicks" invariant in code. */
export const READ_ONLY_STEP_DEFAULTS: Partial<Step> = {
  blockTargetInteraction: true,
  overlayClickAction: false,
  dismissKeyAction: false,
};

/**
 * Build the audience-filtered, translated Joyride steps from `defs` — `TOUR_STEPS` for the
 * whirlwind, or a `TutorialDef`'s `steps` for a per-feature tutorial (`tutorials/*.tsx`).
 * `stepDefaults` (e.g. `READ_ONLY_STEP_DEFAULTS`) is spread into every step before the
 * per-step fields, so a step's own values (none collide today) would still win. Exported for
 * unit tests.
 */
export function buildSteps(
  defs: readonly TourStepDef[],
  translate: (key: ParseKeys, opts?: Record<string, unknown>) => string,
  manager: boolean,
  navigateTo?: (path: string, target?: string) => Promise<void> | void,
  userId?: number | null,
  stepDefaults: Partial<Step> = {},
): Step[] {
  // The total is the audience-filtered count, so headers read "Step X of Y" against the steps this
  // caller will actually see.
  // Roles come straight from the stored session (the `hasFeature` idiom — a render-time read, not
  // reactive), so the caller-relative `manager` flag stays the only argument buildSteps needs.
  const filtered = defs.filter(
    (s) =>
      (!s.managerOnly || manager) &&
      (!s.managerOrHr || manager || isHr()) &&
      (!s.adminOnly || isAdmin()) &&
      (!s.feature || hasFeature(s.feature)),
  );
  const total = filtered.length;
  // A per-user navTo (`:userId`) is unresolvable without a caller id — degrade to not navigating
  // (defensive only; the tour never runs unauthenticated).
  const resolveNavTo = (navTo: string): string | undefined =>
    navTo.includes(":userId")
      ? userId != null
        ? navTo.replace(":userId", String(userId))
        : undefined
      : navTo;
  return filtered.map((s, i) => {
    const text = translate(s.contentKey);
    return {
      ...stepDefaults,
      target: s.target,
      title: translate("tour.stepCounter", { current: i + 1, total }),
      content: s.render ? s.render(text) : text,
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
    };
  });
}

type TourContextValue = {
  /** (Re)starts the whirlwind — resets `tutorial` to null so a replay after a tutorial rebuilds
   *  the whirlwind's step list. */
  startTour: () => void;
  /** Starts a per-feature tutorial (feature-gated by the caller — `Tour.tsx`). */
  startTutorial: (id: TutorialId) => void;
  /** Starts a tutorial from ANY page (v4.4.0, the account menu's Tutorials list): opens the
   *  tutorial's `home` first and starts it once that page is showing. A navigation the discard
   *  guard holds starts nothing — the pending launch is dropped on the next route change that
   *  isn't the home. */
  launchTutorial: (id: TutorialId) => void;
};
export const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within a TourProvider");
  return ctx;
}

// Provider-level actions the custom tooltip needs but Joyride's render props don't expose. Joyride
// renders the tooltip into a portal, but React context still flows through portals, so the tooltip
// (mounted under TourProvider) can read this.
type TourActions = {
  abandon: () => void;
  /** False while a tutorial runs — Pause would strand a resumable beacon inside a form the
   *  tutorial has since navigated away from, so TourTooltip hides it. Undefined/true = pausable
   *  (the whirlwind, and every pre-tutorial caller of TourActionsContext in tests). */
  pausable?: boolean;
};
// Exported for unit tests (so a test can supply a spy `abandon`).
export const TourActionsContext = createContext<TourActions | null>(null);
