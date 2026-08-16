import { useState } from "react";
import { Alert, Button, Group, Modal, Paper, Skeleton, Stack, Text } from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { listDaysOffBudgets } from "../api/daysoff";
import { formatDays } from "../utils/daysOffCost";
import DaysOffCorrections from "./DaysOffCorrections";

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
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const currentUserId = getUserId();
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
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            {t("daysOff.budget.title", { year })}
          </Text>
          {currentUserId != null && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconAdjustments size={14} />}
              onClick={() => setCorrectionsOpen(true)}
            >
              {t("daysOff.corrections.title")}
            </Button>
          )}
        </Group>
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
              {budget.corrected !== 0 && (
                <Stat
                  label={t("daysOff.budget.corrected")}
                  value={`${budget.corrected > 0 ? "+" : ""}${days(budget.corrected)}`}
                />
              )}
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

      {/* The subordinate's read-only view of their corrections (managers edit from the
          budgets table on the team tab). */}
      <Modal
        opened={correctionsOpen}
        onClose={() => setCorrectionsOpen(false)}
        title={t("daysOff.corrections.ownModalTitle")}
        size="lg"
      >
        {currentUserId != null && (
          <DaysOffCorrections userId={currentUserId} defaultYear={year} canManage={false} />
        )}
      </Modal>
    </Paper>
  );
}
