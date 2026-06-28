import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { IconMessagePlus, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  addTeamMember,
  ApiError,
  getTeam,
  getUserId,
  isAdmin,
  listUsers,
  removeTeamMember,
} from "../api/client";

// A single team realistically has a small, bounded set of members; fetch up to the 100-row
// max so the member list and the add-picker exclusion share one complete source of truth.
const PICKER_PAGE_SIZE = 100;

type MemberRow = { id: number; name: string };

export default function TeamMembers() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const queryClient = useQueryClient();
  // Non-admins get a read-only roster: no add picker, no remove buttons.
  const canManage = isAdmin();
  // Everyone may provide feedback for a member — except themselves (provider ≠ subject).
  const currentUserId = getUserId();

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
    enabled: idIsValid,
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
    enabled: idIsValid,
  });

  const { data: userPool } = useQuery({
    queryKey: ["users", "picker"],
    queryFn: () => listUsers({ page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled: idIsValid && canManage,
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
          setAddError(t("teams.addMemberInvalid"));
        } else if (err.status === 403) {
          setAddError(t("teams.modifyForbidden"));
        } else if (err.status === 404) {
          setAddError(t("teams.teamGone"));
        } else {
          setAddError(t("teams.addFailedStatus", { status: err.status }));
        }
      } else {
        setAddError(t("teams.addFailedNetwork"));
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
        <Title order={2}>{t("teams.members")}</Title>
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (teamNotFound || teamIsError) {
    return (
      <Stack gap="md">
        <Title order={2}>{t("teams.members")}</Title>
        <Alert color="red" variant="light">
          {teamNotFound
            ? t("teams.teamNotFound")
            : `${t("teams.loadTeamFailed")}${teamError instanceof ApiError ? ` (${teamError.status})` : ""}.`}
        </Alert>
        <Group justify="flex-end">
          <Button component={RouterLink} to="/teams" variant="default">
            {t("teams.backToTeams")}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>
        {t("teams.members")}
        {team ? ` — ${team.name}` : ""}
      </Title>

      {canManage && (
        <Group align="flex-end" gap="sm">
          <Select
            label={t("teams.addUser")}
            placeholder={t("teams.pickUser")}
            data={addOptions}
            value={selectedUser}
            onChange={setSelectedUser}
            searchable
            clearable
            nothingFoundMessage={t("teams.noUsersAvailable")}
            w={280}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={add}
            disabled={!selectedUser}
            loading={addMutation.isPending}
          >
            {t("teams.add")}
          </Button>
        </Group>
      )}

      {canManage && addError && (
        <Alert color="red" title={t("teams.addMemberFailed")} onClose={() => setAddError(null)} withCloseButton>
          {addError}
        </Alert>
      )}

      {membersIsError && (
        <Alert color="red" title={t("teams.loadMembersFailed")}>
          {membersError instanceof Error ? membersError.message : t("teams.unknownError")}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("common.field.name")}</Table.Th>
            <Table.Th>{t("common.field.email")}</Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
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
                    {m.id !== currentUserId && (
                      <Button
                        component={RouterLink}
                        to={`/feedback/new?subjectId=${m.id}&subjectName=${encodeURIComponent(m.name)}`}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconMessagePlus size={14} />}
                        aria-label={t("users.provideFeedbackFor", { name: m.name })}
                      >
                        {t("users.provideFeedback")}
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        color="red"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => requestRemove({ id: m.id, name: m.name })}
                        aria-label={t("teams.removeAria", { name: m.name })}
                      >
                        {t("teams.remove")}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text c="dimmed" ta="center">
                  {t("teams.noMembersYet")}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {t("common.table.total", { count: members.length })}
        </Text>
        <Button component={RouterLink} to="/teams" variant="default">
          {t("teams.backToTeams")}
        </Button>
      </Group>

      <Modal opened={confirmOpen} onClose={cancelRemove} title={t("teams.removeModalTitle")} centered>
        <Stack gap="md">
          {target && (
            <Text>
              {t("teams.removeConfirmLead")} <strong>{target.name}</strong>{" "}
              {t("teams.removeConfirmMid")} <strong>{team?.name}</strong>?
            </Text>
          )}
          {removeMutation.isError && (
            <Alert color="red" title={t("teams.removeMemberFailed")}>
              {removeMutation.error instanceof Error
                ? removeMutation.error.message
                : t("teams.unknownError")}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={cancelRemove} disabled={removeMutation.isPending}>
              {t("common.action.cancel")}
            </Button>
            <Button color="red" onClick={confirmRemove} loading={removeMutation.isPending}>
              {t("teams.remove")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
