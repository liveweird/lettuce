import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IconArrowDown, IconArrowUp, IconArrowsSort, IconPlus } from "@tabler/icons-react";
import { isAdmin, listTeams, listUsers } from "../api/client";

const PAGE_SIZE = 20;
// TODO: switch to async search when user count exceeds 100.
const MANAGER_PICKER_PAGE_SIZE = 100;

type SortField = "name";
type SortDir = "asc" | "desc";

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
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [nameFilter, setNameFilter] = useState("");
  const [managerIdFilter, setManagerIdFilter] = useState<number | null>(null);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedName, managerIdFilter, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["teams", page, sortParam, debouncedName, managerIdFilter],
    queryFn: () =>
      listTeams({
        page,
        pageSize: PAGE_SIZE,
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

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Stack gap="md">
      <Title order={2}>Teams</Title>

      <Group align="flex-end" gap="sm">
        <TextInput
          label="Name"
          placeholder="contains…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
        />
        <Select
          label="Manager"
          placeholder={managersLoading ? "Loading…" : "Any"}
          data={managerOptions}
          value={managerIdFilter == null ? null : String(managerIdFilter)}
          onChange={(v) => setManagerIdFilter(v == null ? null : Number(v))}
          searchable
          clearable
          disabled={managersLoading}
          nothingFoundMessage="No matching users"
        />
      </Group>

      {isError && (
        <Alert color="red" title="Failed to load teams">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="name"
                label="Name"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>Manager</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={2}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>{t.managerName}</Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={2}>
                <Text c="dimmed" ta="center">
                  No teams
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {total} total
        </Text>
        <Pagination
          value={page}
          onChange={setPage}
          total={totalPages}
          siblings={1}
          withEdges
        />
      </Group>

      {isAdmin() && (
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to="/teams/new"
            leftSection={<IconPlus size={16} />}
          >
            Create team
          </Button>
        </Group>
      )}
    </Stack>
  );
}
