import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconMessagePlus, IconUserPlus } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAllTeams, listTeamMembers, type TeamMemberListView } from "../api/client";
import SortHeader, { type SortDir } from "../components/SortHeader";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

type SortField = "name" | "email" | "teamName";

export default function TeamMembersTable({
  view,
  emptyMessage,
}: {
  view: TeamMemberListView;
  emptyMessage: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [nameFilter, setNameFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState<string | null>(null);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedName, debouncedEmail, teamFilter, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

  const { data: teams } = useQuery({
    queryKey: ["teams", "all"],
    queryFn: listAllTeams,
  });
  const teamOptions = (teams ?? []).map((t) => ({ value: String(t.id), label: t.name }));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "teamMembers",
      view,
      page,
      pageSize,
      sortParam,
      debouncedName,
      debouncedEmail,
      teamFilter,
    ],
    queryFn: () =>
      listTeamMembers({
        view,
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        teamId: teamFilter ? Number(teamFilter) : undefined,
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
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Stack gap="md">
      <Group align="flex-end" gap="sm">
        <TextInput
          label="Name"
          placeholder="contains…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
          rightSection={
            nameFilter ? (
              <CloseButton
                size="sm"
                aria-label="Clear name filter"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setNameFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <TextInput
          label="Email"
          placeholder="contains…"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.currentTarget.value)}
          rightSection={
            emailFilter ? (
              <CloseButton
                size="sm"
                aria-label="Clear email filter"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEmailFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <Select
          label="Team"
          placeholder="Any"
          data={teamOptions}
          value={teamFilter}
          onChange={setTeamFilter}
          clearable
          clearButtonProps={{ "aria-label": "Clear team filter" }}
          searchable
        />
      </Group>

      {isError && (
        <Alert color="red" title="Failed to load team members">
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
                field="teamName"
                label="Team"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label="Actions" style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((m) => (
              <Table.Tr key={`${m.userId}-${m.teamId}`}>
                <Table.Td>{m.name}</Table.Td>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>{m.teamName}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      component={RouterLink}
                      to={`/feedback/new?subjectId=${m.userId}&subjectName=${encodeURIComponent(m.name)}`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconMessagePlus size={14} />}
                      aria-label={`Provide feedback to ${m.name}`}
                    >
                      Provide feedback
                    </Button>
                    {view === "managed" && (
                      <Button
                        component={RouterLink}
                        to={`/feedback/request?subjectId=${m.userId}&subjectName=${encodeURIComponent(m.name)}`}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconUserPlus size={14} />}
                        aria-label={`Request feedback about ${m.name}`}
                      >
                        Request feedback
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed" ta="center">
                  {emptyMessage}
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
        <Group gap="sm" align="center">
          <Select
            size="xs"
            aria-label="Rows per page"
            data={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} / page` }))}
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
    </Stack>
  );
}
