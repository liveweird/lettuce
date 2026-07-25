import { Link as RouterLink } from "react-router-dom";
import { Alert, Button, Select, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconEye, IconPencil, IconTargetArrow } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getUserId,
  listGoals,
  type GoalListItem,
  type GoalListView,
  type GoalStatus,
} from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import GoalStatusBadge from "../components/GoalStatusBadge";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import {
  createdWindowCutoff,
  createdWindowOptions,
  formatDate,
  formatTimestamp,
  type CreatedWindow,
} from "../utils/datetime";
import { AchievedBadge, formatGoalValue } from "../utils/goalValues";

const SORT_FIELDS = ["title", "createdAt", "status", "targetValue", "currentValue"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const CREATED_WINDOWS = ["all", "month", "sixMonths"] as const;
const STATUS_VALUES = ["DRAFT", "ACTIVE", "CLOSED"] as const;

// The BINARY current-value cell is the achieved pill; the numeric types show their numbers.
function CurrentCell({ goal, locale }: { goal: GoalListItem; locale: string }) {
  if (goal.type === "BINARY") return <AchievedBadge achieved={goal.achieved === true} />;
  return <>{formatGoalValue(goal.type, goal.currentValue, locale)}</>;
}

/**
 * The goals list — filters (title substring, creation window, status), sortable columns, paging.
 * Reusable across the caller-relative views like OneOnOneTable; today only `own` is exercised
 * (the per-manager drill-down pins `managerId`, so no person column is rendered yet — the
 * managed/team configurations arrive with the /goals tabs).
 */
export default function GoalTable({
  view,
  managerId,
  settingsKey,
  backTo,
}: {
  view: GoalListView;
  /** Scope to one manager's goals (the per-manager drill-down). */
  managerId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const backParam = backTo ? `&back=${encodeURIComponent(backTo)}` : "";
  const columnCount = 6; // title + created + status + target + current + actions

  const storeKey = settingsKey ?? `goals.${view}`;
  const [titleFilter, setTitleFilter] = useStoredState(`${storeKey}.filter.title`, "", isString);
  const [createdWindow, setCreatedWindow] = useStoredState<CreatedWindow>(
    `${storeKey}.filter.createdWindow`, "all", isOneOf(CREATED_WINDOWS),
  );
  const [statusFilter, setStatusFilter] = useStoredState<GoalStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const activeFilterCount =
    (titleFilter.trim() ? 1 : 0) + (createdWindow !== "all" ? 1 : 0) + (statusFilter ? 1 : 0);

  const [debouncedTitle] = useDebouncedValue(titleFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "createdAt",
      [debouncedTitle, createdWindow, statusFilter],
      { key: storeKey, sortFields: SORT_FIELDS },
      "desc", // newest goals first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "goals",
      view,
      managerId,
      page,
      pageSize,
      sortParam,
      debouncedTitle,
      createdWindow,
      statusFilter,
    ],
    queryFn: () =>
      listGoals({
        view,
        page,
        pageSize,
        sort: sortParam,
        title: debouncedTitle || undefined,
        status: statusFilter ?? undefined,
        managerId,
        createdAtGte: createdWindowCutoff(createdWindow),
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <ClearableTextInput
          label={t("goal.title")}
          value={titleFilter}
          onChange={setTitleFilter}
          clearLabel={t("goal.clearTitleFilter")}
        />
        <Select
          label={t("goal.createdAt")}
          data={createdWindowOptions(t)}
          value={createdWindow}
          onChange={(v) => setCreatedWindow((v as CreatedWindow) ?? "all")}
          allowDeselect={false}
          w={180}
        />
        <Select
          label={t("common.field.status")}
          data={[
            { value: "", label: t("common.state.any") },
            ...STATUS_VALUES.map((s) => ({ value: s, label: t(`goal.status.${s}`) })),
          ]}
          value={statusFilter ?? ""}
          onChange={(v) => setStatusFilter((v as GoalStatus) || null)}
          allowDeselect={false}
          w={160}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("goal.loadListError")}>
          {error instanceof Error ? error.message : t("goal.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="title"
                label={t("goal.title")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="createdAt"
                label={t("goal.createdAt")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="targetValue"
                label={t("goal.target")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="currentValue"
                label={t("goal.current")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((g) => {
              const canEdit =
                currentUserId != null &&
                g.managerId === currentUserId &&
                (g.status === "DRAFT" || g.status === "ACTIVE");
              return (
                <Table.Tr key={g.id}>
                  <Table.Td>
                    <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
                      {g.title}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(g.createdAt)}>
                    {formatDate(g.createdAt, i18n.language)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <GoalStatusBadge status={g.status} />
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatGoalValue(g.type, g.targetValue, i18n.language)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <CurrentCell goal={g} locale={i18n.language} />
                  </Table.Td>
                  <Table.Td>
                    {canEdit ? (
                      <Button
                        component={RouterLink}
                        to={`/goals/${g.id}/edit?from=${view}${backParam}`}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconPencil size={14} />}
                        aria-label={t("goal.editAria", { title: g.title })}
                      >
                        {t("common.action.edit")}
                      </Button>
                    ) : (
                      <Button
                        component={RouterLink}
                        to={`/goals/${g.id}/view?from=${view}${backParam}`}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconEye size={14} />}
                        aria-label={t("goal.viewAria", { title: g.title })}
                      >
                        {t("common.action.view")}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconTargetArrow size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("goal.noGoals")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="goal.rowsPerPage"
      />
    </Stack>
  );
}
