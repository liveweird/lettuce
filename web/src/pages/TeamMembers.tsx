import { useState } from "react";
import { Link as RouterLink, Navigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  addTeamMember,
  ApiError,
  getTeam,
  isAdmin,
  listUsers,
  removeTeamMember,
} from "../api/client";

// A single team realistically has a small, bounded set of members; fetch up to the 100-row
// max so the member list and the add-picker exclusion share one complete source of truth.
const PICKER_PAGE_SIZE = 100;

type MemberRow = { id: number; name: string };

export default function TeamMembers() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const queryClient = useQueryClient();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [target, setTarget] = useState<MemberRow | null>(null);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  const {
    data: team,
    isLoading: teamLoading,
    isError: teamIsError,
    error: teamError,
  } = useQuery({
    queryKey: ["team", id],
    queryFn: () => getTeam(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  const {
    data: membersPage,
    isLoading: membersLoading,
    isError: membersIsError,
    error: membersError,
  } = useQuery({
    queryKey: ["teamMembersList", id],
    queryFn: () => listUsers({ teamId: id, page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    enabled: idIsValid && isAdmin(),
  });

  const { data: userPool } = useQuery({
    queryKey: ["users", "picker"],
    queryFn: () => listUsers({ page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled: idIsValid && isAdmin(),
  });

  const addMutation = useMutation({
    mutationFn: (userId: number) => addTeamMember(id, userId),
    onSuccess: async () => {
      setSelectedUser(null);
      setAddError(null);
      await queryClient.invalidateQueries({ queryKey: ["teamMembersList", id] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setAddError("That user can't be added to this team (they may be its manager).");
        } else if (err.status === 403) {
          setAddError("You don't have permission to modify this team.");
        } else if (err.status === 404) {
          setAddError("Team no longer exists.");
        } else {
          setAddError(`Add failed (${err.status})`);
        }
      } else {
        setAddError("Add failed. Check your connection and try again.");
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: number) => removeTeamMember(id, userId),
    onSuccess: async () => {
      closeConfirm();
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["teamMembersList", id] });
    },
  });

  if (!isAdmin()) return <Navigate to="/teams" replace />;
  if (!idIsValid) return <Navigate to="/teams" replace />;

  const members = membersPage?.items ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const addOptions = (userPool?.items ?? [])
    .filter((u) => !memberIds.has(u.id) && u.id !== team?.managerId)
    .map((u) => ({ value: String(u.id), label: u.name }));

  function requestRemove(row: MemberRow) {
    setTarget(row);
    removeMutation.reset();
    openConfirm();
  }

  function cancelRemove() {
    if (removeMutation.isPending) return;
    closeConfirm();
    setTarget(null);
    removeMutation.reset();
  }

  function confirmRemove() {
    if (target) removeMutation.mutate(target.id);
  }

  function add() {
    if (selectedUser) addMutation.mutate(Number(selectedUser));
  }

  const teamNotFound = teamIsError && teamError instanceof ApiError && teamError.status === 404;

  if (teamLoading) {
    return (
      <Stack gap="md">
        <Title order={2}>Members</Title>
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (teamNotFound || teamIsError) {
    return (
      <Stack gap="md">
        <Title order={2}>Members</Title>
        <Alert color="red" variant="light">
          {teamNotFound
            ? "Team not found."
            : `Failed to load team${teamError instanceof ApiError ? ` (${teamError.status})` : ""}.`}
        </Alert>
        <Group justify="flex-end">
          <Button component={RouterLink} to="/teams" variant="default">
            Back to teams
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>Members{team ? ` — ${team.name}` : ""}</Title>

      <Group align="flex-end" gap="sm">
        <Select
          label="Add a user"
          placeholder="Pick a user"
          data={addOptions}
          value={selectedUser}
          onChange={setSelectedUser}
          searchable
          clearable
          nothingFoundMessage="No users available"
          w={280}
        />
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={add}
          disabled={!selectedUser}
          loading={addMutation.isPending}
        >
          Add
        </Button>
      </Group>

      {addError && (
        <Alert color="red" title="Failed to add member" onClose={() => setAddError(null)} withCloseButton>
          {addError}
        </Alert>
      )}

      {membersIsError && (
        <Alert color="red" title="Failed to load members">
          {membersError instanceof Error ? membersError.message : "Unknown error"}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th aria-label="Actions" style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {membersLoading && !membersPage ? (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : members.length > 0 ? (
            members.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>{m.name}</Table.Td>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap" justify="flex-end">
                    <Button
                      color="red"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => requestRemove({ id: m.id, name: m.name })}
                      aria-label={`Remove ${m.name}`}
                    >
                      Remove
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text c="dimmed" ta="center">
                  No members yet
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {members.length} total
        </Text>
        <Button component={RouterLink} to="/teams" variant="default">
          Back to teams
        </Button>
      </Group>

      <Modal opened={confirmOpen} onClose={cancelRemove} title="Remove from team?" centered>
        <Stack gap="md">
          {target && (
            <Text>
              Remove <strong>{target.name}</strong> from <strong>{team?.name}</strong>?
            </Text>
          )}
          {removeMutation.isError && (
            <Alert color="red" title="Failed to remove member">
              {removeMutation.error instanceof Error
                ? removeMutation.error.message
                : "Unknown error"}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={cancelRemove} disabled={removeMutation.isPending}>
              Cancel
            </Button>
            <Button color="red" onClick={confirmRemove} loading={removeMutation.isPending}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
