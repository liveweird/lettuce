import { createContext, useContext, useState, type ReactNode } from "react";
import { Joyride, STATUS, type Controls, type EventData, type Step } from "react-joyride";
import { useTranslation } from "react-i18next";
import { getUserId, isAdmin } from "../api/client";

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
  /** Shown only to ADMIN callers (the Config area is admin-only). */
  adminOnly?: boolean;
};

// Anchored to the always-present AppShell header + navbar, so every target is in the DOM and no
// cross-route navigation is needed. A missing/hidden target (e.g. a collapsed mobile navbar) is
// skipped by Joyride rather than breaking the tour.
export const TOUR_STEPS: TourStepDef[] = [
  { target: "body", contentKey: "tour.steps.welcome", placement: "center" },
  { target: '[data-tour="nav-dashboard"]', contentKey: "tour.steps.dashboard", placement: "right" },
  { target: '[data-tour="nav-feedback"]', contentKey: "tour.steps.feedback", placement: "right" },
  { target: '[data-tour="nav-config"]', contentKey: "tour.steps.config", placement: "right", adminOnly: true },
  { target: '[data-tour="notifications"]', contentKey: "tour.steps.notifications", placement: "bottom" },
  { target: '[data-tour="language"]', contentKey: "tour.steps.language", placement: "bottom" },
  { target: '[data-tour="theme"]', contentKey: "tour.steps.theme", placement: "bottom" },
  { target: '[data-tour="nav-change-password"]', contentKey: "tour.steps.account", placement: "right" },
  { target: '[data-tour="logout"]', contentKey: "tour.steps.logout", placement: "bottom" },
  { target: '[data-tour="replay"]', contentKey: "tour.steps.replay", placement: "bottom" },
];

/** Build the role-filtered, translated Joyride steps. Exported for unit tests. */
export function buildSteps(
  translate: (key: string, opts?: Record<string, unknown>) => string,
  admin: boolean,
): Step[] {
  // The total is the role-filtered count (9 for USER, 10 for ADMIN), so headers read
  // "Step X of Y" against the steps this caller will actually see.
  const defs = TOUR_STEPS.filter((s) => !s.adminOnly || admin);
  const total = defs.length;
  return defs.map((s, i) => ({
    target: s.target,
    title: translate("tour.stepCounter", { current: i + 1, total }),
    content: translate(s.contentKey),
    placement: s.placement,
    disableBeacon: true,
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
  const userId = getUserId();
  const steps = buildSteps((k, o) => t(k, o), isAdmin());

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
