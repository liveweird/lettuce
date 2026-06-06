import { useEffect, useState } from "react";
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
import { isAdmin, listUsers, type UserRole } from "../api/client";

const PAGE_SIZE = 20;

type SortField = "name" | "email" | "role";
type SortDir = "asc" | "desc";

const ROLE_OPTIONS = [
  { value: "", label: "Any" },
  { value: "ADMIN", label: "Admin" },
  { value: "USER", label: "User" },
];

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

export default function Users() {
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [nameFilter, setNameFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedName, debouncedEmail, roleFilter, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users", page, sortParam, debouncedName, debouncedEmail, roleFilter],
    queryFn: () =>
      listUsers({
        page,
        pageSize: PAGE_SIZE,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        role: roleFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

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
      <Title order={2}>Users</Title>

      <Group align="flex-end" gap="sm">
        <TextInput
          label="Name"
          placeholder="contains…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
        />
        <TextInput
          label="Email"
          placeholder="contains…"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.currentTarget.value)}
        />
        <Select
          label="Role"
          data={ROLE_OPTIONS}
          value={roleFilter}
          onChange={(v) => setRoleFilter((v ?? "") as UserRole | "")}
          allowDeselect={false}
        />
      </Group>

      {isError && (
        <Alert color="red" title="Failed to load users">
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
            <Table.Th>
              <SortHeader
                field="email"
                label="Email"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="role"
                label="Role"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>{u.role}</Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text c="dimmed" ta="center">
                  No users
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
            to="/users/new"
            leftSection={<IconPlus size={16} />}
          >
            Create user
          </Button>
        </Group>
      )}
    </Stack>
  );
}
