import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
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
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  addTeamMember,
  ApiError,
  getUser,
  isAdmin,
  listAllTeams,
  listTeams,
  removeTeamMember,
} from "../api/client";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import PersonaChip from "../components/PersonaChip";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";

type TeamRow = { id: number; name: string };

export default function UserTeams() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const queryClient = useQueryClient();
  // Non-admins get a read-only list: no add picker, no remove buttons.
  const canManage = isAdmin();
  // getUser is self-or-admin only, so non-admins can't fetch another user's record — the name
  // comes from a ?name= param passed by the /users list instead.
  const [searchParams] = useSearchParams();
  const nameParam = searchParams.get("name");

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const {
    data: user,
    isLoading: userLoading,
    isError: userIsError,
    error: userError,
  } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && canManage,
    retry: false,
  });

  const {
    data: teamsPage,
    isLoading: teamsLoading,
    isError: teamsIsError,
    error: teamsError,
  } = useQuery({
    queryKey: ["userTeams", id],
    // A single user is realistically a member of only a handful of teams; fetch up to the
    // 100-row max in one query (no pagination UI) so the add-dropdown exclusion below has a
    // single, complete source of truth.
    queryFn: () => listTeams({ memberId: id, page: 1, pageSize: 100, sort: "name" }),
    enabled: idIsValid,
  });

  const { data: allTeams } = useQuery({
    queryKey: ["teams", "all"],
    queryFn: listAllTeams,
    enabled: idIsValid && canManage,
  });

  const addMutation = useMutation({
    mutationFn: (teamId: number) => addTeamMember(teamId, id),
    onSuccess: async () => {
      setSelectedTeam(null);
      setAddError(null);
      await queryClient.invalidateQueries({ queryKey: ["userTeams", id] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setAddError(t("users.cannotAddToTeam"));
        } else if (err.status === 403) {
          setAddError(t("users.noPermissionModifyTeam"));
        } else if (err.status === 404) {
          setAddError(t("users.teamNoLongerExists"));
        } else {
          setAddError(t("users.addFailedStatus", { status: err.status }));
        }
      } else {
        setAddError(t("users.addFailedNetwork"));
      }
    },
  });

  const removeConfirm = useDeleteConfirm<TeamRow>({
    mutationFn: (row) => removeTeamMember(row.id, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["userTeams", id] });
    },
  });

  if (!idIsValid) return <Navigate to="/users" replace />;

  const displayName = user?.name ?? nameParam ?? null;
  const memberTeams = teamsPage?.items ?? [];
  const memberTeamIds = new Set(memberTeams.map((team) => team.id));
  const addOptions = (allTeams ?? [])
    .filter((team) => !memberTeamIds.has(team.id) && team.managerId !== id)
    .map((team) => ({ value: String(team.id), label: team.name }));

  function add() {
    if (selectedTeam) addMutation.mutate(Number(selectedTeam));
  }

  const userNotFound = userIsError && userError instanceof ApiError && userError.status === 404;

  if (userLoading) {
    return (
      <Stack gap="md">
        <Title order={2}>{t("users.teams")}</Title>
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (userNotFound || userIsError) {
    return (
      <Stack gap="md">
        <Title order={2}>{t("users.teams")}</Title>
        <Alert color="red" variant="light">
          {userNotFound
            ? t("users.userNotFound")
            : `${t("users.loadUserFailed")}${userError instanceof ApiError ? ` (${userError.status})` : ""}.`}
        </Alert>
        <Group justify="flex-end">
          <Button component={RouterLink} to="/users" variant="default">
            {t("users.backToUsers")}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("users.teams")}{displayName ? ` — ${displayName}` : ""}</Title>

      {canManage && (
        <Group align="flex-end" gap="sm">
          <Select
            label={t("users.addToTeam")}
            placeholder={t("users.pickATeam")}
            data={addOptions}
            value={selectedTeam}
            onChange={setSelectedTeam}
            searchable
            clearable
            nothingFoundMessage={t("users.noTeamsAvailable")}
            w={280}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={add}
            disabled={!selectedTeam}
            loading={addMutation.isPending}
          >
            {t("users.add")}
          </Button>
        </Group>
      )}

      {canManage && addError && (
        <Alert color="red" title={t("users.addToTeamFailed")} onClose={() => setAddError(null)} withCloseButton>
          {addError}
        </Alert>
      )}

      {teamsIsError && (
        <Alert color="red" title={t("users.loadTeamsFailed")}>
          {teamsError instanceof Error ? teamsError.message : t("users.unknownError")}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("users.team")}</Table.Th>
            <Table.Th>{t("common.field.manager")}</Table.Th>
            {canManage && <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {teamsLoading && !teamsPage ? (
            <Table.Tr>
              <Table.Td colSpan={canManage ? 3 : 2}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : memberTeams.length > 0 ? (
            memberTeams.map((team) => (
              <Table.Tr key={team.id}>
                <Table.Td>{team.name}</Table.Td>
                <Table.Td>
                  {team.managerDeleted ? (
                    <Text size="sm" c="dimmed">
                      {team.managerName} {t("users.deletedTag")}
                    </Text>
                  ) : (
                    <PersonaChip name={team.managerName} />
                  )}
                </Table.Td>
                {canManage && (
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap" justify="flex-end">
                      <Button
                        color="red"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => removeConfirm.requestDelete({ id: team.id, name: team.name })}
                        aria-label={t("users.removeFromAria", { name: team.name })}
                      >
                        {t("users.remove")}
                      </Button>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={canManage ? 3 : 2}>
                <Text c="dimmed" ta="center">
                  {t("users.notMemberOfAnyTeam")}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {t("common.table.total", { count: memberTeams.length })}
        </Text>
        <Button component={RouterLink} to="/users" variant="default">
          {t("users.backToUsers")}
        </Button>
      </Group>

      <ConfirmDeleteModal
        confirm={removeConfirm}
        title={t("users.removeTitle")}
        errorTitle={t("users.removeFromTeamFailed")}
        unknownError={t("users.unknownError")}
        confirmLabel={t("users.remove")}
        body={(row) => (
          <>
            {t("users.removeConfirmLead")} <strong>{displayName}</strong>{" "}
            {t("users.removeConfirmFrom")} <strong>{row.name}</strong>?
          </>
        )}
      />
    </Stack>
  );
}
