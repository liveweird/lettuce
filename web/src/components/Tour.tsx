import { lazy, Suspense, useContext, useState, type ReactNode } from "react";
// Types only — erased at build time. The runtime react-joyride import lives solely in
// TourJoyride.tsx, which is lazy-loaded below so the library stays out of the entry chunk.
import type { TooltipRenderProps } from "react-joyride";

const TourJoyride = lazy(() => import("./TourJoyride"));
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getUserId, listTeams } from "../api/client";
// Steps, seen-state, contexts and useTour live in tourSupport.ts so this file only exports
// components (react-refresh/only-export-components).
import {
  buildSteps,
  hasSeenTour,
  markSeen,
  TourActionsContext,
  TourContext,
  waitForElement,
} from "./tourSupport";

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
  return (
    <Paper {...tooltipProps} p="md" radius="md" shadow="md" withBorder maw={360}>
      <Stack gap="sm">
        {step.title && (
          <Text size="xs" fw={600} c="dimmed">
            {step.title}
          </Text>
        )}
        <Text size="sm">{step.content}</Text>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" variant="default" onClick={() => controls.close()}>
              {t("tour.nav.pause")}
            </Button>
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

  function handleFinished() {
    setRun(false);
    markSeen(userId);
  }

  // "Abandon": stop the tour, remount so the internal step index resets to the first step, and mark
  // it seen (so it won't auto-pop again; Replay still re-runs). With run=false no beacon is shown —
  // the difference from "Pause" (controls.close()), which keeps the resumable beacon.
  function handleAbandon() {
    setRun(false);
    setTourKey((k) => k + 1);
    markSeen(userId);
  }

  return (
    <TourContext.Provider value={{ startTour }}>
      {children}
      <TourActionsContext.Provider value={{ abandon: handleAbandon }}>
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
