import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { deleteTeam, isAdmin, listTeams, listUsers } from "../api/client";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;
// TODO: switch to async search when user count exceeds 100.
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [nameFilter, setNameFilter] = useState("");
  const [managerIdFilter, setManagerIdFilter] = useState<number | null>(null);
  const [target, setTarget] = useState<TeamRow | null>(null);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  const queryClient = useQueryClient();
  const admin = isAdmin();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedName, managerIdFilter, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTeam(id),
    onSuccess: async () => {
      closeConfirm();
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function requestDelete(row: TeamRow) {
    setTarget(row);
    deleteMutation.reset();
    openConfirm();
  }

  function cancelDelete() {
    if (deleteMutation.isPending) return;
    closeConfirm();
    setTarget(null);
    deleteMutation.reset();
  }

  function confirmDelete() {
    if (target) deleteMutation.mutate(target.id);
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The actions column is always present now — everyone gets a "Members" button (read-only
  // for non-admins); only Edit/Delete inside it are admin-gated.
  const columnCount = 5;

  return (
    <Stack gap="md">
      <Title order={2} data-tour="config-teams">{t("teams.title")}</Title>

      <Group align="flex-end" gap="sm">
        <TextInput
          label={t("common.field.name")}
          placeholder={t("common.filter.contains")}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
          rightSection={
            nameFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("teams.clearNameFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setNameFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
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
      </Group>

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
                        requestDelete({ id: team.id, name: team.name, managerName: team.managerName })
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

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {t("common.table.total", { count: total })}
        </Text>
        <Group gap="sm" align="center">
          <Select
            size="xs"
            aria-label={t("teams.rowsPerPage")}
            data={PAGE_SIZE_OPTIONS.map((n) => ({
              value: String(n),
              label: t("common.table.perPage", { count: n }),
            }))}
            value={String(pageSize)}
            onChange={(v) => {
              if (!v) return;
              setPageSize(Number(v));
              setPage(1);
            }}
            allowDeselect={false}
            w={110}
          />
          <Pagination
            value={page}
            onChange={setPage}
            total={totalPages}
            siblings={1}
            withEdges
          />
        </Group>
      </Group>

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

      <Modal
        opened={confirmOpen}
        onClose={cancelDelete}
        title={t("teams.deleteModalTitle")}
        centered
      >
        <Stack gap="md">
          {target && (
            <Text>
              {t("teams.deleteTitle", { name: target.name, manager: target.managerName })}{" "}
              {t("teams.deleteUndone")}
            </Text>
          )}
          {deleteMutation.isError && (
            <Alert color="red" title={t("teams.deleteFailed")}>
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("teams.unknownError")}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={cancelDelete} disabled={deleteMutation.isPending}>
              {t("common.action.cancel")}
            </Button>
            <Button color="red" onClick={confirmDelete} loading={deleteMutation.isPending}>
              {t("common.action.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
