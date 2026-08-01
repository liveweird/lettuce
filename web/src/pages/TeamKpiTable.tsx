import { Link as RouterLink } from "react-router-dom";
import { Alert, Button, Select, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconChartLine, IconEye } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTeamKpis, type TeamKpiListView, type TeamKpiStatus } from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import TeamKpiStatusBadge from "../components/TeamKpiStatusBadge";
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
import { formatGoalValue } from "../utils/goalValues";
import { teamKpiViewLink } from "../utils/teamKpiLinks";

const BASE_SORT_FIELDS = ["title", "createdAt", "status", "targetValue", "currentValue"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "teamName";

const CREATED_WINDOWS = ["all", "month", "sixMonths"] as const;
const STATUS_VALUES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

/**
 * The team-KPI list — filters (title substring, team substring, creation window, status),
 * sortable columns, paging; the GoalTable shape. Reusable across the caller-relative views:
 * MyTeamKpis embeds `own` and `managed` unpinned (a Team column shows, since rows span teams),
 * the /teams/:id/kpis drill-down pins one team via `teamId` (the Team column hides — the page
 * names the team already). The row action is always View (v1.29.0) — the view screen is THE KPI
 * screen; the manager's affordances (data points, lifecycle, the DRAFT editor link) live there.
 */
export default function TeamKpiTable({
  view,
  teamId,
  settingsKey,
  backTo,
}: {
  view: TeamKpiListView;
  /** Scope to one team's KPIs (the per-team drill-down); hides the Team column. */
  teamId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
}) {
  const { t, i18n } = useTranslation();
  const teamColumnVisible = teamId == null;
  const sortFields: readonly SortField[] = teamColumnVisible
    ? [...BASE_SORT_FIELDS, "teamName"]
    : BASE_SORT_FIELDS;
  const columnCount = sortFields.length + 1; // sortable columns + the actions column

  const storeKey = settingsKey ?? `teamKpis.${view}`;
  const [titleFilter, setTitleFilter] = useStoredState(`${storeKey}.filter.title`, "", isString);
  const [teamFilter, setTeamFilter] = useStoredState(`${storeKey}.filter.team`, "", isString);
  const [createdWindow, setCreatedWindow] = useStoredState<CreatedWindow>(
    `${storeKey}.filter.createdWindow`, "all", isOneOf(CREATED_WINDOWS),
  );
  const [statusFilter, setStatusFilter] = useStoredState<TeamKpiStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const activeFilterCount =
    (titleFilter.trim() ? 1 : 0) +
    (teamColumnVisible && teamFilter.trim() ? 1 : 0) +
    (createdWindow !== "all" ? 1 : 0) +
    (statusFilter ? 1 : 0);

  const [debouncedTitle] = useDebouncedValue(titleFilter, 300);
  const [debouncedTeam] = useDebouncedValue(teamFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "createdAt",
      [debouncedTitle, debouncedTeam, createdWindow, statusFilter],
      { key: storeKey, sortFields },
      "desc", // newest KPIs first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "teamKpis",
      view,
      teamId,
      page,
      pageSize,
      sortParam,
      debouncedTitle,
      debouncedTeam,
      createdWindow,
      statusFilter,
    ],
    queryFn: () =>
      listTeamKpis({
        view,
        page,
        pageSize,
        sort: sortParam,
        title: debouncedTitle || undefined,
        teamName: (teamColumnVisible && debouncedTeam) || undefined,
        status: statusFilter ?? undefined,
        teamId,
        createdAtGte: createdWindowCutoff(createdWindow),
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <ClearableTextInput
          label={t("teamKpi.title")}
          value={titleFilter}
          onChange={setTitleFilter}
          clearLabel={t("teamKpi.clearTitleFilter")}
        />
        {teamColumnVisible && (
          <ClearableTextInput
            label={t("teamKpi.team")}
            value={teamFilter}
            onChange={setTeamFilter}
            clearLabel={t("teamKpi.clearTeamFilter")}
          />
        )}
        <Select
          label={t("teamKpi.createdAt")}
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
            ...STATUS_VALUES.map((s) => ({ value: s, label: t(`teamKpi.status.${s}`) })),
          ]}
          value={statusFilter ?? ""}
          onChange={(v) => setStatusFilter((v as TeamKpiStatus) || null)}
          allowDeselect={false}
          w={160}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("teamKpi.loadListError")}>
          {error instanceof Error ? error.message : t("teamKpi.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            {teamColumnVisible && (
              <Table.Th>
                <SortHeader
                  field="teamName"
                  label={t("teamKpi.team")}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            )}
            <Table.Th>
              <SortHeader
                field="title"
                label={t("teamKpi.title")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="createdAt"
                label={t("teamKpi.createdAt")}
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
                label={t("teamKpi.target")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="currentValue"
                label={t("teamKpi.current")}
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
            data.items.map((k) => {
              const backParam = backTo || undefined;
              return (
                <Table.Tr key={k.id}>
                  {teamColumnVisible && (
                    <Table.Td>
                      <Text size="sm" lineClamp={1} style={{ wordBreak: "break-word" }}>
                        {k.teamName}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
                      {k.title}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(k.createdAt)}>
                    {formatDate(k.createdAt, i18n.language)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <TeamKpiStatusBadge status={k.status} />
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatGoalValue(k.type, k.targetValue, i18n.language)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatGoalValue(k.type, k.currentValue, i18n.language)}
                  </Table.Td>
                  <Table.Td>
                    <Button
                      component={RouterLink}
                      to={teamKpiViewLink(k.id, backParam)}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconEye size={14} />}
                      aria-label={t("teamKpi.viewAria", { title: k.title })}
                    >
                      {t("common.action.view")}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              );
            })
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconChartLine size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("teamKpi.noKpis")}
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
        rowsPerPageLabelKey="teamKpi.rowsPerPage"
      />
    </Stack>
  );
}
