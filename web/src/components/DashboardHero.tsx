import { Group, Paper, SimpleGrid, Skeleton, Text, ThemeIcon } from "@mantine/core";
import {
  IconClipboardText,
  IconInbox,
  IconMessage2,
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
}: {
  label: string;
  value: string;
  to: string;
  icon: React.ReactNode;
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
        </div>
      </Group>
    </Paper>
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
          <Skeleton key={i} height={72} radius="md" />
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
          to="/?tab=reviews"
          icon={<IconClipboardText size={20} />}
        />
      )}
    </SimpleGrid>
  );
}
