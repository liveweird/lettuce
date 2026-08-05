import { Alert, Group, Paper, Skeleton, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listDaysOffBudgets } from "../api/client";
import { formatDays } from "../utils/daysOffCost";

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack gap={0} miw={90}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={strong ? 700 : 500}>
        {value}
      </Text>
    </Stack>
  );
}

/**
 * The caller's own paid-days budget for [year]: allowance, carry-over, reserved (pending),
 * used (accepted), remaining. An unconfigured allowance gets the orange hint — PAID requests
 * are impossible until an admin sets one.
 */
export default function DaysOffBudgetCard({ year }: { year: number }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffBudgets", "own", year],
    queryFn: () => listDaysOffBudgets("own", year),
  });
  const budget = data?.[0];
  const days = (v: number) => formatDays(v, i18n.language);

  if (isError) {
    return (
      <Alert color="red" variant="light">
        {t("daysOff.budget.loadError")}
      </Alert>
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          {t("daysOff.budget.title", { year })}
        </Text>
        {isLoading || !budget ? (
          <Skeleton height={44} />
        ) : (
          <>
            <Group gap="xl" wrap="wrap">
              <Stat
                label={t("daysOff.budget.allowance")}
                value={budget.allowance != null ? days(budget.allowance) : "—"}
              />
              <Stat label={t("daysOff.budget.carriedOver")} value={days(budget.carriedOver)} />
              <Stat label={t("daysOff.budget.reserved")} value={days(budget.reserved)} />
              <Stat label={t("daysOff.budget.used")} value={days(budget.used)} />
              <Stat label={t("daysOff.budget.remaining")} value={days(budget.remaining)} strong />
            </Group>
            {budget.allowance == null && (
              <Text size="xs" c="orange">
                {t("daysOff.budget.noAllowance")}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
