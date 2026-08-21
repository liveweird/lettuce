import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { getDaysOffCalendar, type DaysOffCalendarScope } from "../api/daysoff";
import DaysOffBudgetCard from "../components/DaysOffBudgetCard";
import DaysOffBudgetsTable from "../components/DaysOffBudgetsTable";
import DaysOffMonthGrid from "../components/DaysOffMonthGrid";
import { useIsManager } from "../hooks/useIsManager";
import { isOneOf, useStoredState } from "../hooks/useStoredState";
import { addIsoMonths, currentIsoMonth, formatIsoMonth } from "../utils/datetime";
import { daysOffCreateLink, daysOffListLink } from "../utils/daysOffLinks";
import DaysOffTable from "./DaysOffTable";
import { loadErrorMessage } from "../utils/saveError";

const TABS = ["calendar", "requests", "team"] as const;
type DaysOffTab = (typeof TABS)[number];
const SCOPES = ["member", "managed"] as const;

function isDaysOffTab(value: string | null): value is DaysOffTab {
  return TABS.includes(value as DaysOffTab);
}

function CalendarTab({ isManager }: { isManager: boolean }) {
  const { t, i18n } = useTranslation();
  // The month is deliberately not persisted — a calendar visit starts at "now".
  const [month, setMonth] = useState(currentIsoMonth());
  const [storedScope, setScope] = useStoredState<(typeof SCOPES)[number]>(
    "daysOff.calendar.scope", "member", isOneOf(SCOPES),
  );
  // A stored managed scope degrades gracefully if the caller stops managing.
  const scope: DaysOffCalendarScope = isManager ? storedScope : "member";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["daysOffCalendar", scope, month],
    queryFn: () => getDaysOffCalendar(month, scope),
  });

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="xs" align="center">
          <ActionIcon
            variant="default"
            onClick={() => setMonth((m) => addIsoMonths(m, -1))}
            aria-label={t("daysOff.calendar.previousMonth")}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={600} w={150} ta="center">
            {formatIsoMonth(month, i18n.language)}
          </Text>
          <ActionIcon
            variant="default"
            onClick={() => setMonth((m) => addIsoMonths(m, 1))}
            aria-label={t("daysOff.calendar.nextMonth")}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
        {isManager && (
          <Select
            label={t("daysOff.calendar.scope")}
            data={SCOPES.map((s) => ({ value: s, label: t(`daysOff.calendar.scope_${s}`) }))}
            value={scope}
            onChange={(v) => v && setScope(v as (typeof SCOPES)[number])}
            allowDeselect={false}
            w={210}
          />
        )}
      </Group>

      {isError ? (
        <Alert color="red" variant="light" title={t("daysOff.calendar.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      ) : isLoading || !data ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : data.users.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("daysOff.calendar.empty")}
        </Text>
      ) : (
        <DaysOffMonthGrid data={data} />
      )}
    </Stack>
  );
}

/**
 * The nav "Days off" page: the team calendar (member scope for everyone, managed scope for
 * managers), the caller's own requests + budget, and — managers only — the direct reports'
 * requests (with Accept/Reject) and budgets.
 */
export default function DaysOff() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;

  const requestedTab = searchParams.get("tab");
  const activeTab: DaysOffTab =
    isDaysOffTab(requestedTab) && (requestedTab !== "team" || isManager)
      ? requestedTab
      : "calendar";

  function selectTab(value: string | null) {
    if (!isDaysOffTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("daysOff.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="calendar" data-tour="days-off-calendar">
            {t("daysOff.tab.calendar")}
          </Tabs.Tab>
          <Tabs.Tab value="requests" data-tour="days-off-requests">
            {t("daysOff.tab.requests")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="team" data-tour="days-off-team">
              {t("daysOff.tab.team")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="calendar" pt="md">
          <CalendarTab isManager={isManager} />
        </Tabs.Panel>

        <Tabs.Panel value="requests" pt="md">
          <Stack gap="md">
            <DaysOffBudgetCard year={new Date().getFullYear()} />
            <DaysOffTable view="own" />
            <Group justify="flex-end">
              <Button
                component={RouterLink}
                to={daysOffCreateLink(daysOffListLink("requests"))}
                leftSection={<IconPlus size={16} />}
              >
                {t("daysOff.newRequest")}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <Stack gap="lg">
              <Text size="sm" c="dimmed">
                {t("daysOff.teamHint")}
              </Text>
              <DaysOffTable view="managed" />
              {/* The on-behalf recording entry (v2.29.0) sits below the request list — the
                  house footer convention; the entry is born ACCEPTED, so it lands right here. */}
              <Group justify="flex-end">
                <Button
                  component={RouterLink}
                  to={daysOffCreateLink(daysOffListLink("team"), true)}
                  leftSection={<IconPlus size={16} />}
                >
                  {t("daysOff.newForReport")}
                </Button>
              </Group>
              <DaysOffBudgetsTable />
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
