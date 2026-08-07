import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Button, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IconChartLine, IconUsers } from "@tabler/icons-react";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isString, useStoredState } from "../hooks/useStoredState";
import { getUserId, hasFeature, listTeams } from "../api/client";
import { teamKpisLink } from "../utils/teamKpiLinks";

const SORT_FIELDS = ["name"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "myTeams";

// The Dashboard "My teams" tab: the teams the caller manages (server-side managerId filter),
// each opening its team-scoped subordinates view (/teams/:id/subordinates) — NOT the /teams
// roster screen. Visually a slice of the Teams page: name column + one Members button; no
// manager column (it is always the caller) and no admin actions.
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
          {error instanceof Error ? error.message : t("teams.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="name"
                label={t("common.field.name")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label={t("teams.members")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((team) => (
              <Table.Tr key={team.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {team.name}
                  </Text>
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Button
                    component={RouterLink}
                    to={`/teams/${team.id}/subordinates`}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconUsers size={14} />}
                    aria-label={t("teams.membersOfAria", { name: team.name })}
                  >
                    {t("teams.members")}
                  </Button>
                  {hasFeature("TEAM_KPIS") && (
                    <Button
                      component={RouterLink}
                      to={teamKpisLink(team.id)}
                      variant="subtle"
                      size="xs"
                      leftSection={<IconChartLine size={14} />}
                      aria-label={t("teams.kpisOfAria", { name: team.name })}
                    >
                      {t("teams.kpis")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("dashboard.empty.myTeams")}
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
        rowsPerPageLabelKey="teams.rowsPerPage"
      />
    </Stack>
  );
}
