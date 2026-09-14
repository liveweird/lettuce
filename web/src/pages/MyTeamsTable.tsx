import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Anchor, Stack } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IconChartLine, IconUsers } from "@tabler/icons-react";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isString, useStoredState } from "../hooks/useStoredState";
import { getUserId, hasFeature } from "../api/session";
import { listTeams } from "../api/teams";
import { teamKpisLink } from "../utils/teamKpiLinks";
import { teamDetailsLink } from "../utils/teamLinks";
import { loadErrorMessage } from "../utils/saveError";

const SORT_FIELDS = ["name"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "myTeams";

// The Dashboard "My teams" tab: the teams the caller manages (server-side managerId filter).
// The team name links to the team-details view (the v2.5.4 convention), where a manager
// lands directly on their subordinates card grid (v2.5.5). No manager column (always the
// caller), no admin actions; the only row button is the Team-KPIs drill-down.
export default function MyTeamsTable() {
  const { t } = useTranslation();
  const uid = getUserId();
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const activeFilterCount = nameFilter.trim() ? 1 : 0;

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS,
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["teams", "managed", uid, page, pageSize, sortParam, debouncedName],
    queryFn: () =>
      listTeams({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        managerId: uid!,
      }),
    // Without a caller id the managerId filter would be omitted and the list would show ALL
    // teams — never fire in that (shouldn't-happen) state.
    enabled: uid != null,
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const columnCount = 2;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ClearableTextInput
          label={t("common.field.name")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("teams.clearNameFilter")}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("teams.loadFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="normal">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable><SortHeader
                field="name"
                label={t("common.field.name")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("teams.kpis")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((team) => (
              <ResponsiveTable.Tr key={team.id}>
                <ResponsiveTable.Td label={t("common.field.name")} primary>
                  {/* The team name links to the team-details view, where the manager lands on
                      their subordinates grid (v2.5.5); ?from=myTeams keeps the back link here. */}
                  <Anchor
                    component={RouterLink}
                    to={`${teamDetailsLink(team.id)}?from=myTeams`}
                    size="sm"
                    fw={500}
                    aria-label={t("teams.detailsForAria", { name: team.name })}
                  >
                    {team.name}
                  </Anchor>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>
                  {hasFeature("TEAM_KPIS") && (
                    <RowActions
                      primary={{
                        icon: <IconChartLine size={16} />,
                        label: t("teams.kpis"),
                        ariaLabel: t("teams.kpisOfAria", { name: team.name }),
                        to: teamKpisLink(team.id),
                      }}
                    />
                  )}
                </ResponsiveTable.Td>
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("dashboard.empty.myTeams")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="teams.rowsPerPage"
      />
    </Stack>
  );
}
