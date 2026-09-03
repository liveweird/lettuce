import { useState } from "react";
import { Alert, Badge, Button, Group, Modal, Paper, Skeleton, Stack, Text } from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { listDaysOffBudgets, type DaysOffBudget } from "../api/daysoff";
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

// One pool's figures (v3.2.0): the sub-title names the pool once the user holds more than one.
function PoolStats({ pool, titled }: { pool: DaysOffBudget; titled: boolean }) {
  const { t, i18n } = useTranslation();
  const days = (v: number) => formatDays(v, i18n.language);
  return (
    <Stack gap={4}>
      {titled && (
        <Group gap="xs" align="center">
          <Text size="sm" fw={500}>
            {pool.poolName}
          </Text>
          {pool.poolArchived && (
            <Badge size="xs" variant="light" color="gray">
              {t("daysOff.pool.archived")}
            </Badge>
          )}
          {!pool.carriesOver && !pool.poolArchived && (
            <Text size="xs" c="dimmed">
              {t("daysOff.pool.resetsShort")}
            </Text>
          )}
        </Group>
      )}
      <Group gap="xl" wrap="wrap">
        <Stat
          label={t("daysOff.budget.allowance")}
          value={pool.allowance != null ? days(pool.allowance) : "—"}
        />
        <Stat label={t("daysOff.budget.carriedOver")} value={days(pool.carriedOver)} />
        {pool.corrected !== 0 && (
          <Stat
            label={t("daysOff.budget.corrected")}
            value={`${pool.corrected > 0 ? "+" : ""}${days(pool.corrected)}`}
          />
        )}
        <Stat label={t("daysOff.budget.reserved")} value={days(pool.reserved)} />
        <Stat label={t("daysOff.budget.used")} value={days(pool.used)} />
        <Stat label={t("daysOff.budget.remaining")} value={days(pool.remaining)} strong />
      </Group>
      {pool.isDefault && pool.allowance == null && (
        <Text size="xs" c="orange">
          {t("daysOff.budget.noAllowance")}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The caller's own paid-days budgets for [year] — since v3.2.0 one group per paid pool (the
 * default pool first, then the extras by name, then archived history): allowance, carry-over,
 * reserved (pending), used (accepted), remaining. An unconfigured default allowance gets the
 * orange hint — PAID requests in that pool are impossible until a manager sets one.
 */
export default function DaysOffBudgetCard({ year }: { year: number }) {
  const { t } = useTranslation();
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const currentUserId = getUserId();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffBudgets", "own", year],
    queryFn: () => listDaysOffBudgets("own", year),
  });
  const pools = data ?? [];

  if (isError) {
    return (
      <Alert color="red" variant="light">
        {t("daysOff.budget.loadError")}
      </Alert>
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
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
        {isLoading || pools.length === 0 ? (
          <Skeleton height={44} />
        ) : (
          pools.map((pool) => <PoolStats key={pool.poolTypeId} pool={pool} titled={pools.length > 1} />)
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
