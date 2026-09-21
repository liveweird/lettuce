import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Select,
  Stack,
  Text
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers
} from "@tabler/icons-react";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import TableLoadingRow from "../components/TableLoadingRow";
import SortHeader from "../components/SortHeader";
import PersonaChip from "../components/PersonaChip";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isNumberOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { useManagerOptions } from "../hooks/useManagerOptions";
import { getUserId, isAdmin } from "../api/session";
import { deleteTeam, listTeams } from "../api/teams";
import { userDetailsLink } from "../utils/userLinks";
import { teamDetailsLink } from "../utils/teamLinks";
import { loadErrorMessage } from "../utils/saveError";
import PageHeader from "../components/PageHeader";
import { renderUserOption } from "../components/userOptions";
import ResponsiveTable from "../components/ResponsiveTable";

const SORT_FIELDS = ["name"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "teams";

type TeamRow = { id: number; name: string; managerName: string };

export default function Teams() {
  const { t } = useTranslation();
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [managerIdFilter, setManagerIdFilter] = useStoredState<number | null>(
    `${SETTINGS_KEY}.filter.managerId`,
    null,
    isNumberOrNull,
  );
  const activeFilterCount = (nameFilter.trim() ? 1 : 0) + (managerIdFilter != null ? 1 : 0);

  const queryClient = useQueryClient();
  const admin = isAdmin();
  const currentUserId = getUserId();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName, managerIdFilter], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["teams", page, pageSize, sortParam, debouncedName, managerIdFilter],
    queryFn: () =>
      listTeams({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        managerId: managerIdFilter ?? undefined
      }),
    placeholderData: keepPreviousData
  });

  const { managerOptions, managersLoading } = useManagerOptions();

  const deleteConfirm = useDeleteConfirm<TeamRow>({
    mutationFn: (row) => deleteTeam(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams"] }),
    successMessage: t("teams.toast.deleted")
  });

  const total = data?.total ?? 0;
  // The team name itself links to the team-details view (v2.5.4) — the action columns hold
  // only the admin-gated Edit/Delete, so non-admin rows carry no buttons at all.
  const columnCount = 3;

  return (
    <Stack gap="md">
      <PageHeader
        title={t("teams.title")}
        actions={
          admin && (
            <Button component={RouterLink} to="/teams/new" leftSection={<IconPlus size={16} />}>
              {t("teams.createTeam")}
            </Button>
          )
        }
      />

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ClearableTextInput
          label={t("common.field.name")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("teams.clearNameFilter")}
        />
        <Select
          label={t("common.field.manager")}
          placeholder={managersLoading ? t("common.state.loading") : t("common.state.any")}
          data={managerOptions}
          renderOption={renderUserOption}
          value={managerIdFilter == null ? null : String(managerIdFilter)}
          onChange={(v) => setManagerIdFilter(v == null ? null : Number(v))}
          searchable
          clearable
          disabled={managersLoading}
          nothingFoundMessage={t("teams.noMatchingUsers")}
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
            <ResponsiveTable.Th sortable>
              <SortHeader
                field="name"
                label={t("common.field.name")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("common.field.manager")}</ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((team) => (
              <ResponsiveTable.Tr key={team.id}>
                <ResponsiveTable.Td label={t("common.field.name")} primary>
                  {/* The team name links to the team-details view (name + manager + roster). */}
                  <Anchor
                    component={RouterLink}
                    to={teamDetailsLink(team.id)}
                    size="sm"
                    fw={500}
                    aria-label={t("teams.detailsForAria", { name: team.name })}
                  >
                    {team.name}
                  </Anchor>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("common.field.manager")}>
                  {team.managerDeleted ? (
                    <Text size="sm" c="dimmed">
                      {team.managerName}
                      {t("teams.deletedSuffix")}
                    </Text>
                  ) : (
                    // The manager's name links to their details — the aria carries the name,
                    // so whose details it opens is unambiguous. One's own persona stays a
                    // plain chip (the /users own-row rule).
                    <PersonaChip
                      name={team.managerName}
                      to={
                        team.managerId !== currentUserId
                          ? userDetailsLink(team.managerId, team.managerName, "teams")
                          : undefined
                      }
                      ariaLabel={t("users.detailsFor", { name: team.managerName })}
                    />
                  )}
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>
                  {admin && (
                    <RowActions
                      name={team.name}
                      primary={{
                        icon: <IconPencil size={16} />,
                        label: t("common.action.edit"),
                        ariaLabel: t("teams.editAria", { name: team.name }),
                        to: `/teams/${team.id}/edit`,
                      }}
                      items={[
                        {
                          icon: <IconTrash size={14} />,
                          label: t("common.action.delete"),
                          ariaLabel: t("teams.deleteAria", { name: team.name }),
                          color: "red",
                          onClick: () =>
                            deleteConfirm.requestDelete({
                              id: team.id,
                              name: team.name,
                              managerName: team.managerName,
                            }),
                        },
                      ]}
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
                  label={t("teams.noTeams")}
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

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("teams.deleteModalTitle")}
        errorTitle={t("teams.deleteFailed")}
        body={(target) => (
          <>
            {t("teams.deleteTitle", { name: target.name, manager: target.managerName })}{" "}
            {t("teams.deleteUndone")}
          </>
        )}
      />
    </Stack>
  );
}
