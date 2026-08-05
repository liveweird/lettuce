import { Group, Paper, SimpleGrid, Skeleton, Text, ThemeIcon } from "@mantine/core";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconClipboardText,
  IconInbox,
  IconMessage2,
  IconMinus,
  IconTargetArrow,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getDashboardSummary } from "../api/client";
import classes from "./DashboardHero.module.css";

const GRID_COLS = { base: 2, sm: 3, lg: 5 };

// One stat tile: sentence-case label, semibold proportional-figure value, a light brand icon.
// The whole tile is a link to the screen the number comes from — text stays in text tokens.
function StatTile({
  label,
  value,
  to,
  icon,
  sub,
}: {
  label: string;
  value: string;
  to: string;
  icon: React.ReactNode;
  /** Optional trend sub-line under the value (its own text node — tests key on bare values). */
  sub?: React.ReactNode;
}) {
  return (
    <Paper
      component={RouterLink}
      to={to}
      withBorder
      radius="md"
      p="md"
      shadow="xs"
      className={classes.tile}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon variant="light" size={36} radius="md">
          {icon}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" lineClamp={2}>
            {label}
          </Text>
          <Text fz={26} fw={600} lh={1.2}>
            {value}
          </Text>
          {sub}
        </div>
      </Group>
    </Paper>
  );
}

// The vs-previous-window trend line: neutral dimmed styling on purpose — receiving less
// feedback is a fact, not an error state. The caption wraps rather than truncating — narrow
// tiles (5-col grid) don't fit "+N vs previous 30 days" on one line.
function TrendLine({ delta, caption }: { delta: number; caption: string }) {
  const Arrow = delta > 0 ? IconArrowUpRight : delta < 0 ? IconArrowDownRight : IconMinus;
  const signed = delta > 0 ? `+${delta}` : String(delta);
  return (
    <Group gap={4} mt={2}>
      <Group gap={4} wrap="nowrap">
        <Arrow size={14} color="var(--mantine-color-dimmed)" aria-hidden />
        <Text size="xs" c="dimmed" span>
          {signed}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" span>
        {caption}
      </Text>
    </Group>
  );
}

/**
 * The Dashboard's at-a-glance row: personal, actionable counts for everyone plus two manager
 * tiles (gated on having direct reports; the reviews tile additionally needs a review period
 * covering today). One caller-scoped query; renders skeletons while loading and NOTHING on
 * error or malformed data — the hero must never break the dashboard (the AlertsBanner rule).
 */
export default function DashboardHero() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: getDashboardSummary,
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <SimpleGrid cols={GRID_COLS} spacing="md">
        {[0, 1, 2].map((i) => (
          // Matches the tile height including the received tile's trend sub-line (the grid
          // row stretches every tile to the tallest), so load doesn't shift the layout.
          <Skeleton key={i} height={92} radius="md" />
        ))}
      </SimpleGrid>
    );
  }
  if (data == null || typeof data.pendingFeedbackRequests !== "number") return null;

  const isManager = data.directReports > 0;
  const showReviews = isManager && data.currentPeriodId != null;
  return (
    <SimpleGrid cols={GRID_COLS} spacing="md">
      <StatTile
        label={t("dashboard.hero.pendingRequests")}
        value={String(data.pendingFeedbackRequests)}
        to="/feedback?tab=provided"
        icon={<IconMessage2 size={20} />}
      />
      <StatTile
        label={t("dashboard.hero.activeGoals")}
        value={String(data.activeGoals)}
        to="/goals"
        icon={<IconTargetArrow size={20} />}
      />
      <StatTile
        label={t("dashboard.hero.received30d")}
        value={String(data.feedbackReceived30d)}
        to="/feedback?tab=received"
        icon={<IconInbox size={20} />}
        sub={
          // Per-field narrowing, NOT part of the shape probe above: an older server without
          // the field simply renders no trend line.
          typeof data.feedbackReceivedPrev30d === "number" ? (
            <TrendLine
              delta={data.feedbackReceived30d - data.feedbackReceivedPrev30d}
              caption={t("dashboard.hero.vsPrev30d")}
            />
          ) : undefined
        }
      />
      {isManager && (
        <StatTile
          label={t("dashboard.hero.directReports")}
          value={String(data.directReports)}
          to="/?tab=subordinates"
          icon={<IconUsersGroup size={20} />}
        />
      )}
      {showReviews && (
        <StatTile
          label={t("dashboard.hero.reviewsDone")}
          value={`${data.currentPeriodReviewsDone ?? 0}/${data.directReports}`}
          to="/performance?tab=managed"
          icon={<IconClipboardText size={20} />}
        />
      )}
    </SimpleGrid>
  );
}
