import { lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
// Types only — erased at build time. The runtime react-joyride import lives solely in
// TourJoyride.tsx, which is lazy-loaded below so the library stays out of the entry chunk.
import type { TooltipRenderProps } from "react-joyride";

const TourJoyride = lazy(() => import("./TourJoyride"));
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { hasFeature, getUserId } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
// Steps, seen-state, contexts and useTour live in tourSupport.ts so this file only exports
// components (react-refresh/only-export-components).
import {
  buildSteps,
  hasSeenTour,
  markSeen,
  READ_ONLY_STEP_DEFAULTS,
  TourActionsContext,
  TourContext,
  TOUR_STEPS,
  waitForElement,
} from "./tourSupport";
import { TUTORIALS } from "../tutorials";
import type { TutorialId } from "../tutorials/types";

/**
 * Custom Joyride tooltip — replaces the library default so we can drop its corner "x" and offer two
 * explicit close actions instead:
 *   • Pause   — `controls.close()`: in continuous mode this parks on the next step's beacon (the
 *               black dot), leaving the tour resumable. Exactly the old "x" behavior.
 *   • Abandon — ends the tour, resets it to step 1, and marks it seen (provider's `abandon`).
 * Back / Next (Done) keep the library-supplied handlers via the spread `*Props`. Exported for tests.
 */
export function TourTooltip({
  step,
  index,
  isLastStep,
  backProps,
  primaryProps,
  tooltipProps,
  controls,
}: TooltipRenderProps) {
  const { t } = useTranslation();
  const actions = useContext(TourActionsContext);
  // A tutorial's rich step (buildSteps' `render`) supplies non-string content — e.g. an SVG
  // beside its caption. An SVG inside Mantine Text's <p> is invalid HTML, so rich content is
  // rendered raw instead, and the wider box gives a diagram room to breathe.
  const rich = typeof step.content !== "string";
  // Hidden while a tutorial runs (`pausable: false`) — Pause would strand a resumable beacon
  // inside a screen the tutorial has since navigated away from, and a tutorial is meant to be
  // replayed from its own launcher rather than resumed mid-flight.
  const pausable = actions?.pausable !== false;
  return (
    <Paper {...tooltipProps} p="md" radius="md" shadow="md" withBorder maw={rich ? 560 : 360}>
      <Stack gap="sm">
        {step.title && (
          <Text size="xs" fw={600} c="dimmed">
            {step.title}
          </Text>
        )}
        {rich ? step.content : <Text size="sm">{step.content}</Text>}
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            {pausable && (
              <Button size="xs" variant="default" onClick={() => controls.close()}>
                {t("tour.nav.pause")}
              </Button>
            )}
            <Button size="xs" variant="light" color="red" onClick={() => actions?.abandon()}>
              {t("tour.nav.abandon")}
            </Button>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {index > 0 && (
              <Button size="xs" variant="default" {...backProps}>
                {t("tour.nav.back")}
              </Button>
            )}
            <Button size="xs" {...primaryProps}>
              {isLastStep ? t("tour.nav.last") : t("tour.nav.next")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}

/** A tutorial home's route path — the `?tab=` part is the tutorial's own business (its steps
 *  navigate between tabs), so arriving on any tab of the hub counts as being home. */
const homePathname = (home: string) => home.split("?")[0];

export function TourProvider({
  children,
  onStart,
}: {
  children: ReactNode;
  /** Fired whenever the tour (re)starts — the shell un-collapses the navbar so every
   *  nav-targeting step has a visible anchor. Also fired once for the auto-start. */
  onStart?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = getUserId();
  // Whether the caller manages a team — gates the manager-only steps. The shared hook's cache
  // key dedupes this with the tab-gate queries on the feature pages.
  const isManager = useIsManager();
  // A step's `navTo` switches the view before it shows — the target pages derive their state from
  // the URL. Wait for the step's target to mount before resolving so Joyride never tries to show a
  // step whose (possibly cold lazy-loaded) target isn't there yet.
  const navigateTo = (path: string, target?: string) =>
    new Promise<void>((resolve) => {
      navigate(path);
      if (target) void waitForElement(target).then(resolve);
      else setTimeout(resolve, 0);
    });
  // Non-null while a per-feature tutorial (tutorials/*.tsx) is running instead of the whirlwind —
  // its step list replaces TOUR_STEPS, and READ_ONLY_STEP_DEFAULTS is spread into every one of its
  // steps (never the whirlwind's) so a tutorial only ever looks, never touches real data.
  const [tutorial, setTutorial] = useState<TutorialId | null>(null);
  const defs = tutorial ? TUTORIALS[tutorial].steps : TOUR_STEPS;
  const steps = buildSteps(
    defs,
    (k, o) => t(k, o),
    isManager,
    navigateTo,
    userId,
    tutorial ? READ_ONLY_STEP_DEFAULTS : {},
  );

  // Auto-start once per account: run on mount when authenticated and not yet seen.
  const [run, setRun] = useState(() => userId != null && !hasSeenTour(userId));
  // Bumped on Replay/a (re)start so Joyride remounts and restarts from the first step.
  const [tourKey, setTourKey] = useState(0);

  function startTour() {
    onStart?.();
    // Rebuilds the whirlwind's step list even right after a tutorial finished/was abandoned.
    setTutorial(null);
    setTourKey((k) => k + 1);
    setRun(true);
  }

  function startTutorial(id: TutorialId) {
    const def = TUTORIALS[id];
    // Mirrors the page guards' `hasFeature` check — a caller without the feature gets no
    // tutorial (its own anchors wouldn't exist to spotlight either).
    if (def.feature && !hasFeature(def.feature)) return;
    onStart?.();
    setTutorial(id);
    setTourKey((k) => k + 1);
    setRun(true);
  }

  // A menu launch (launchTutorial) waiting for its home page: the tutorial, and the location key it
  // left from — so "the route has changed" is told apart from "still on the page it was launched
  // on" (a navigation the discard guard is holding keeps the old key).
  const [pendingLaunch, setPendingLaunch] = useState<{ id: TutorialId; fromKey: string } | null>(null);

  function launchTutorial(id: TutorialId) {
    const def = TUTORIALS[id];
    if (def.feature && !hasFeature(def.feature)) return;
    if (location.pathname === homePathname(def.home)) {
      startTutorial(id);
      return;
    }
    setPendingLaunch({ id, fromKey: location.key });
    navigate(def.home);
  }

  // Starts a pending launch once its home is showing. The first route change after the launch
  // settles it either way: the home starts the tutorial, anywhere else drops it — so a launch the
  // discard guard held and the user then left elsewhere never springs up later by surprise.
  useEffect(() => {
    if (!pendingLaunch || location.key === pendingLaunch.fromKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- settles a launch on the route change it waited for; the start also notifies the shell (onStart), which cannot run during render
    setPendingLaunch(null);
    if (location.pathname === homePathname(TUTORIALS[pendingLaunch.id].home)) startTutorial(pendingLaunch.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the route change only: startTutorial is re-created every render and reads nothing the effect needs to track
  }, [location.key, location.pathname, pendingLaunch]);

  // The auto-start sets run=true in the initializer, bypassing startTour — notify the shell
  // once on mount too. Mount-only by design: `run` and `onStart` are the mount-time values.
  useEffect(() => {
    if (run) onStart?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design: reads run/onStart's mount-time values, must not re-fire on later changes
  }, []);

  function handleFinished() {
    setRun(false);
    if (tutorial) {
      const home = TUTORIALS[tutorial].home;
      setTutorial(null);
      navigate(home, { replace: true });
    } else {
      markSeen(userId);
    }
  }

  // "Abandon": stop the tour, remount so the internal step index resets to the first step. The
  // whirlwind marks itself seen (so it won't auto-pop again; Replay still re-runs) — a tutorial
  // never does (it always starts fresh from its own launcher) and instead returns to its home,
  // the same landing spot Finish uses. With run=false no beacon is shown — the difference from
  // "Pause" (controls.close()), which keeps the resumable beacon.
  function handleAbandon() {
    setRun(false);
    setTourKey((k) => k + 1);
    if (tutorial) {
      const home = TUTORIALS[tutorial].home;
      setTutorial(null);
      navigate(home, { replace: true });
    } else {
      markSeen(userId);
    }
  }

  return (
    <TourContext.Provider value={{ startTour, startTutorial, launchTutorial }}>
      {children}
      {/* Pause is hidden while a tutorial runs (pausable: false) — a paused tutorial would
          strand a resumable beacon inside the form it navigated into. */}
      <TourActionsContext.Provider value={{ abandon: handleAbandon, pausable: tutorial == null }}>
        {/* Mounted only once the tour has (ever) run this session, so returning users who've
            seen it never download the react-joyride chunk. Pause keeps run=true, so the
            resumable beacon survives; a replay bumps tourKey and keeps it mounted. */}
        {(run || tourKey > 0) && (
          <Suspense fallback={null}>
            <TourJoyride
              tourKey={tourKey}
              steps={steps}
              run={run}
              tooltipComponent={TourTooltip}
              onFinished={handleFinished}
            />
          </Suspense>
        )}
      </TourActionsContext.Provider>
    </TourContext.Provider>
  );
}
