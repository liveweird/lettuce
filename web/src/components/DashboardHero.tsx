import { Button, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconClipboardText,
  IconHeartRateMonitor,
  IconInbox,
  IconInfoCircle,
  IconMessage2,
  IconTargetArrow,
  IconUsersGroup,
  IconArrowRight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { getDashboardSummary } from "../api/dashboard";
import { formatIsoDate } from "../utils/datetime";
import classes from "./DashboardHero.module.css";

// The loading skeleton's columns; the live grid derives its columns from the visible tile
// count (v3.4.0) — three tiles fill the row, six become 3×2.
const GRID_COLS = { base: 2, sm: 3, lg: 5 };

function heroGridCols(tileCount: number) {
  return {
    base: Math.max(1, Math.min(tileCount, 2)),
    sm: Math.max(1, Math.min(tileCount, 3)),
    lg: tileCount <= 5 ? Math.max(1, tileCount) : Math.ceil(tileCount / 2),
  };
}

const signedDelta = (delta: number) => (delta > 0 ? `+${delta}` : String(delta));

// One summary link: a sentence-case label, tabular value and quiet icon.
// The whole tile is a link to the screen the number comes from — text stays in text tokens.
function StatTile({
  label,
  value,
  to,
  icon,
  hint,
}: {
  label: string;
  value: string;
  to: string;
  icon: React.ReactNode;
  /** Optional comment shown as a hover tooltip on a hint icon after the value — never a
   * visible sub-line, so every tile keeps the same height. Dimmed on purpose: the trend is
   * a fact, not an error state. */
  hint?: string;
}) {
  return (
    <Paper
      component={RouterLink}
      to={to}
      radius="md"
      p="md"
      className={classes.tile}
    >
      <Group gap="xs" justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="xs" c="dimmed" className={classes.label}>{label}</Text>
        <span className={classes.icon} aria-hidden="true">{icon}</span>
      </Group>
      <Group gap={8} mt="sm" wrap="nowrap" align="center">
        <Text fz={28} fw={600} lh={1.2} className={classes.value}>{value}</Text>
        {hint != null && (
          <Tooltip label={hint}>
            <IconInfoCircle size={16} color="var(--mantine-color-dimmed)" role="img" aria-label={hint} />
          </Tooltip>
        )}
      </Group>
    </Paper>
  );
}

function ActionCallout({
  title,
  detail,
  action,
  to,
  icon,
}: {
  title: string;
  detail: string;
  action: string;
  to: string;
  icon: React.ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="lg" className={classes.callout}>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" className={classes.calloutCopy}>
          <span className={classes.calloutIcon} aria-hidden="true">{icon}</span>
          <div>
            <Text fw={650}>{title}</Text>
            <Text size="sm" c="dimmed">{detail}</Text>
          </div>
        </Group>
        <Button component={RouterLink} to={to} variant="light" rightSection={<IconArrowRight size={16} />}>
          {action}
        </Button>
      </Group>
    </Paper>
  );
}

/**
 * The Dashboard's v5 quiet summary strip: personal, actionable counts for everyone plus two manager
 * tiles (gated on having direct reports; the reviews tile additionally needs a review period
 * covering today). One caller-scoped query; renders skeletons while loading and NOTHING on
 * error or malformed data — the hero must never break the dashboard (the AlertsBanner rule).
 */
export default function DashboardHero() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const { data, isLoading } = useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: getDashboardSummary,
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <SimpleGrid cols={GRID_COLS} spacing="md">
        {[0, 1, 2].map((i) => (
          // Matches the uniform tile height (two reserved label lines + value), so load
          // doesn't shift the layout.
          <Skeleton key={i} height={92} radius="md" />
        ))}
      </SimpleGrid>
    );
  }
  if (data == null || typeof data.pendingFeedbackRequests !== "number") return null;

  const isManager = data.directReports > 0;
  // Per-user feature flags (v1.53.0): a tile hides with its feature — the summary endpoint
  // itself stays ungated, so the counts are present but deliberately unrendered.
  const showReviews = isManager && data.currentPeriodId != null && hasFeature("PERFORMANCE_REVIEWS");
  const showFeedback = hasFeature("FEEDBACKS");
  const showPendingFeedback = showFeedback && data.pendingFeedbackRequests > 0;
  const showOpenPulse =
    hasFeature("PULSE_SURVEYS") &&
    typeof data.pulseOpenCloseDate === "string" &&
    data.pulseSubmitted !== true;
  const callouts = [
    showPendingFeedback ? (
      <ActionCallout
        key="requests"
        title={t("dashboard.hero.pendingRequestsAction", { count: data.pendingFeedbackRequests })}
        detail={t("dashboard.hero.pendingRequestsHint")}
        action={t("dashboard.hero.openRequests")}
        to="/feedback?tab=provided"
        icon={<IconMessage2 size={22} />}
      />
    ) : null,
    showOpenPulse ? (
      <ActionCallout
        key="pulse"
        title={t("dashboard.hero.pulseAction")}
        detail={t("dashboard.hero.pulseCloses", {
          date: formatIsoDate(data.pulseOpenCloseDate!, locale),
        })}
        action={t("dashboard.hero.openPulse")}
        to="/pulse?tab=survey"
        icon={<IconHeartRateMonitor size={22} />}
      />
    ) : null,
  ].filter((callout) => callout != null);
  const tiles = [
    showFeedback && !showPendingFeedback ? (
      <StatTile
        key="requests"
        label={t("dashboard.hero.pendingRequests")}
        value={String(data.pendingFeedbackRequests)}
        to="/feedback?tab=provided"
        icon={<IconMessage2 size={20} />}
      />
    ) : null,
    hasFeature("GOALS") ? (
      <StatTile
        key="goals"
        label={t("dashboard.hero.activeGoals")}
        value={String(data.activeGoals)}
        to="/goals"
        icon={<IconTargetArrow size={20} />}
      />
    ) : null,
    showFeedback ? (
      <StatTile
        key="received"
        label={t("dashboard.hero.received30d")}
        value={String(data.feedbackReceived30d)}
        to="/feedback?tab=received"
        icon={<IconInbox size={20} />}
        hint={
          // Per-field narrowing, NOT part of the shape probe above: an older server without
          // the field simply renders no trend hint.
          typeof data.feedbackReceivedPrev30d === "number"
            ? `${signedDelta(data.feedbackReceived30d - data.feedbackReceivedPrev30d)} ${t("dashboard.hero.vsPrev30d")}`
            : undefined
        }
      />
    ) : null,
    isManager ? (
      <StatTile
        key="reports"
        label={t("dashboard.hero.directReports")}
        value={String(data.directReports)}
        to="/?tab=subordinates"
        icon={<IconUsersGroup size={20} />}
      />
    ) : null,
    showReviews ? (
      <StatTile
        key="reviews"
        label={t("dashboard.hero.reviewsDone")}
        value={String(data.currentPeriodReviewsDone ?? 0)}
        to="/performance?tab=managed"
        icon={<IconClipboardText size={20} />}
      />
    ) : null,
    hasFeature("PULSE_SURVEYS") && typeof data.pulseOpenCloseDate === "string" && !showOpenPulse ? (
      // Only participants of an OPEN cycle get the field (per-field narrowing — an older
      // server simply renders no tile); the wording flips once they've submitted.
      <StatTile
        key="pulse"
        label={
          data.pulseSubmitted === true
            ? t("dashboard.hero.pulseSubmitted")
            : t("dashboard.hero.pulseOpen")
        }
        value={formatIsoDate(data.pulseOpenCloseDate, locale)}
        to="/pulse?tab=survey"
        icon={<IconHeartRateMonitor size={20} />}
      />
    ) : null,
  ].filter((tile) => tile != null);
  if (tiles.length === 0 && callouts.length === 0) return null;
  return (
    <Stack gap="sm">
      {callouts.length > 0 && <Stack gap="sm">{callouts}</Stack>}
      {tiles.length > 0 && (
        <SimpleGrid cols={heroGridCols(tiles.length)} spacing={0} className={classes.strip}>
          {tiles}
        </SimpleGrid>
      )}
    </Stack>
  );
}
