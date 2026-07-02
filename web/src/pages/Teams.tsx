import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { deleteTeam, isAdmin, listTeams, listUsers } from "../api/client";

const MANAGER_PICKER_PAGE_SIZE = 100;

type SortField = "name";
type SortDir = "asc" | "desc";

type TeamRow = { id: number; name: string; managerName: string };

function SortHeader({
  field,
  label,
  activeField,
  activeDir,
  onToggle,
}: {
  field: SortField;
  label: string;
  activeField: SortField;
  activeDir: SortDir;
  onToggle: (field: SortField) => void;
}) {
  const isActive = activeField === field;
  const Icon = !isActive ? IconArrowsSort : activeDir === "asc" ? IconArrowUp : IconArrowDown;
  return (
    <UnstyledButton
      onClick={() => onToggle(field)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}
    >
      <span>{label}</span>
      <Icon size={14} stroke={1.5} opacity={isActive ? 1 : 0.4} />
    </UnstyledButton>
  );
}

export default function Teams() {
  const { t } = useTranslation();
  const [nameFilter, setNameFilter] = useState("");
  const [managerIdFilter, setManagerIdFilter] = useState<number | null>(null);
  const activeFilterCount = (nameFilter.trim() ? 1 : 0) + (managerIdFilter != null ? 1 : 0);

  const queryClient = useQueryClient();
  const admin = isAdmin();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName, managerIdFilter]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["teams", page, pageSize, sortParam, debouncedName, managerIdFilter],
    queryFn: () =>
      listTeams({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        managerId: managerIdFilter ?? undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const { data: managerPool, isLoading: managersLoading } = useQuery({
    queryKey: ["users", "managerPicker"],
    queryFn: () => listUsers({ page: 1, pageSize: MANAGER_PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
  });

  const managerOptions = useMemo(
    () =>
      (managerPool?.items ?? []).map((u) => ({
        value: String(u.id),
        label: u.name,
      })),
    [managerPool],
  );

  const deleteConfirm = useDeleteConfirm<TeamRow>({
    mutationFn: (row) => deleteTeam(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams"] }),
  });

  const total = data?.total ?? 0;
  // The actions column is always present now — everyone gets a "Members" button (read-only
  // for non-admins); only Edit/Delete inside it are admin-gated.
  const columnCount = 5;

  return (
    <Stack gap="md">
      <Title order={2} data-tour="config-teams">{t("teams.title")}</Title>

      <FilterPanel activeFilterCount={activeFilterCount}>
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
          value={managerIdFilter == null ? null : String(managerIdFilter)}
          onChange={(v) => setManagerIdFilter(v == null ? null : Number(v))}
          searchable
          clearable
          disabled={managersLoading}
          nothingFoundMessage={t("teams.noMatchingUsers")}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" title={t("teams.loadFailed")}>
          {error instanceof Error ? error.message : t("teams.unknownError")}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
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
            <Table.Th>{t("common.field.manager")}</Table.Th>
            <Table.Th aria-label={t("common.action.edit")} style={{ width: 1 }} />
            <Table.Th aria-label={t("teams.members")} style={{ width: 1 }} />
            <Table.Th aria-label={t("common.action.delete")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((team) => (
              <Table.Tr key={team.id}>
                <Table.Td>{team.name}</Table.Td>
                <Table.Td>
                  {team.managerName}
                  {team.managerDeleted ? t("teams.deletedSuffix") : ""}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {admin && (
                    <Button
                      component={RouterLink}
                      to={`/teams/${team.id}/edit`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconPencil size={14} />}
                      aria-label={t("teams.editAria", { name: team.name })}
                    >
                      {t("common.action.edit")}
                    </Button>
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Button
                    component={RouterLink}
                    to={`/teams/${team.id}/members`}
                    color="blue"
                    variant="subtle"
                    size="xs"
                    leftSection={<IconUsers size={14} />}
                    aria-label={t("teams.membersOfAria", { name: team.name })}
                  >
                    {t("teams.members")}
                  </Button>
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {admin && (
                    <Button
                      color="red"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      onClick={() =>
                        deleteConfirm.requestDelete({
                          id: team.id,
                          name: team.name,
                          managerName: team.managerName,
                        })
                      }
                      aria-label={t("teams.deleteAria", { name: team.name })}
                    >
                      {t("common.action.delete")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Text c="dimmed" ta="center">
                  {t("teams.noTeams")}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
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

      {admin && (
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to="/teams/new"
            leftSection={<IconPlus size={16} />}
          >
            {t("teams.createTeam")}
          </Button>
        </Group>
      )}

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("teams.deleteModalTitle")}
        errorTitle={t("teams.deleteFailed")}
        unknownError={t("teams.unknownError")}
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
