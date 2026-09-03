import { Alert, Badge, Button, Group, Modal, Select, Stack, Table, Text } from "@mantine/core";
import { IconAdjustments, IconBeach } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { listDaysOffBudgets, type DaysOffBudget } from "../api/daysoff";
import { formatDays } from "../utils/daysOffCost";
import DaysOffCorrections from "./DaysOffCorrections";
import EmptyState from "./EmptyState";
import PersonCell from "./PersonCell";
import TableLoadingRow from "./TableLoadingRow";

const COLUMN_COUNT = 9;

/**
 * The manager's budget overview: one row per (direct report, paid pool) for the picked
 * calendar year (current ±1 — carry-over makes the neighbors the only interesting ones);
 * since v3.2.0 a person spans as many rows as they hold pools (the default first — the Pool
 * column names it). Corrections are chain-editable (v2.33.0), so every row here — direct by
 * construction — is manage-capable; the action opens the modal on that row's pool.
 */
export default function DaysOffBudgetsTable() {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  // Whose corrections modal is open (the manager's edit surface — v1.43.0), on which pool.
  const [correctionsFor, setCorrectionsFor] = useState<DaysOffBudget | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffBudgets", "managed", year],
    queryFn: () => listDaysOffBudgets("managed", year),
  });
  const days = (v: number) => formatDays(v, i18n.language);
  const poolsOf = (userId: number) =>
    (data ?? [])
      .filter((b) => b.userId === userId && !b.poolArchived)
      .map((b) => ({ id: b.poolTypeId, name: b.poolName }));

  return (
    <Stack gap="sm">
      {/* The compact toolbar line (v2.32.1, matching the drill-down's budget strip): the
          year Select drops its stacked label (aria-label keeps it accessible) so title and
          picker share a centerline. */}
      <Group justify="space-between" align="center">
        <Text size="sm" fw={600}>
          {t("daysOff.budget.teamTitle")}
        </Text>
        <Select
          size="xs"
          aria-label={t("daysOff.budget.year")}
          data={[currentYear - 1, currentYear, currentYear + 1].map((y) => String(y))}
          value={String(year)}
          onChange={(v) => v && setYear(Number(v))}
          allowDeselect={false}
          w={90}
        />
      </Group>

      {isError && (
        <Alert color="red" variant="light">
          {t("daysOff.budget.loadError")}
        </Alert>
      )}

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("daysOff.calendar.personColumn")}</Table.Th>
            <Table.Th>{t("daysOff.pool.label")}</Table.Th>
            <Table.Th>{t("daysOff.budget.allowance")}</Table.Th>
            <Table.Th>{t("daysOff.budget.carriedOver")}</Table.Th>
            <Table.Th>{t("daysOff.budget.corrected")}</Table.Th>
            <Table.Th>{t("daysOff.budget.reserved")}</Table.Th>
            <Table.Th>{t("daysOff.budget.used")}</Table.Th>
            <Table.Th>{t("daysOff.budget.remaining")}</Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={COLUMN_COUNT} />
          ) : data && data.length > 0 ? (
            data.map((b) => (
              <Table.Tr key={`${b.userId}-${b.poolTypeId}`}>
                <Table.Td>
                  {/* The person cell repeats on every pool row — a sortable, filterable
                      flat table beats rowspans for the reading order. */}
                  <PersonCell
                    userId={b.userId}
                    name={b.userName}
                    deleted={b.userDeleted}
                    currentUserId={currentUserId}
                  />
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" span>
                      {b.poolName}
                    </Text>
                    {b.poolArchived && (
                      <Badge size="xs" variant="light" color="gray">
                        {t("daysOff.pool.archived")}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{b.allowance != null ? days(b.allowance) : "—"}</Table.Td>
                <Table.Td>{days(b.carriedOver)}</Table.Td>
                <Table.Td>{b.corrected === 0 ? "—" : `${b.corrected > 0 ? "+" : ""}${days(b.corrected)}`}</Table.Td>
                <Table.Td>{days(b.reserved)}</Table.Td>
                <Table.Td>{days(b.used)}</Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600} span>
                    {days(b.remaining)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {/* ONE corrections entry per person (on their default row — the modal's Pool
                      select reaches the extra pools), so the action label stays unique. */}
                  {b.isDefault && (
                    <Button
                      variant="subtle"
                      size="xs"
                      leftSection={<IconAdjustments size={14} />}
                      onClick={() => setCorrectionsFor(b)}
                      aria-label={t("daysOff.corrections.openAria", { name: b.userName })}
                    >
                      {t("daysOff.corrections.title")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={COLUMN_COUNT}>
                <EmptyState
                  icon={<IconBeach size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("daysOff.budget.noReports")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      <Modal
        opened={correctionsFor != null}
        onClose={() => setCorrectionsFor(null)}
        title={t("daysOff.corrections.modalTitle", { name: correctionsFor?.userName ?? "" })}
        size="lg"
      >
        {correctionsFor && (
          <DaysOffCorrections
            userId={correctionsFor.userId}
            defaultYear={year}
            canManage
            pools={poolsOf(correctionsFor.userId)}
          />
        )}
      </Modal>
    </Stack>
  );
}
