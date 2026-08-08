import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Anchor,
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
import {
  IconId,
  IconPlus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import {
  addTeamMember,
  ApiError,
  getTeam,
  getUserId,
  hasFeature,
  isAdmin,
  listAllUsers,
  listUsers,
  removeTeamMember,
} from "../api/client";
import { showSuccessToast } from "../utils/toast";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import FeedbackActionsMenu from "../components/FeedbackActionsMenu";
import PersonaChip from "../components/PersonaChip";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { feedbackAskLink, feedbackProvideLink, userFeedbacksLink } from "../utils/feedbackLinks";
import { userDetailsLink } from "../utils/userLinks";
import { saveErrorMessage } from "../utils/saveError";

// A single team realistically has a small, bounded set of members; fetch up to the 100-row
// max so the member list and the add-picker exclusion share one complete source of truth.
const PICKER_PAGE_SIZE = 100;

type MemberRow = { id: number; name: string };

export default function TeamMembers() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  // The org chart opens rosters with ?from=org — back links return there, not to the teams
  // list (the UserDetails origin idiom, reduced to the one extra origin this page can have).
  const [searchParams] = useSearchParams();
  const fromOrg = searchParams.get("from") === "org";
  const backTo = fromOrg ? "/org" : "/teams";
  const backLabel = fromOrg
    ? t("feedback.backToLabel", { label: t("feedback.origin.org") })
    : t("teams.backToTeams");
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const queryClient = useQueryClient();
  // Non-admins get a read-only roster: no add picker, no remove buttons.
  const canManage = isAdmin();
  // Everyone may provide feedback for a member — except themselves (provider ≠ subject).
  const currentUserId = getUserId();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

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

  // EVERY user, all pages (the v1.51.0 useManagerOptions lesson, second site): a single
  // name-sorted page silently loses candidates once the org outgrows the server's max
  // pageSize. Client-sorted by name below.
  const { data: userPool } = useQuery({
    queryKey: ["users", "picker"],
    queryFn: listAllUsers,
    staleTime: 5 * 60 * 1000,
    enabled: idIsValid && canManage,
  });

  const addMutation = useMutation({
    mutationFn: (userId: number) => addTeamMember(id, userId),
    onSuccess: async () => {
      setSelectedUser(null);
      setAddError(null);
      await queryClient.invalidateQueries({ queryKey: ["teamMembersList", id] });
      showSuccessToast(t("teams.toast.memberAdded"));
    },
    onError: (err) => {
      setAddError(
        saveErrorMessage(err, t, {
          forbidden: "teams.modifyForbidden",
          notFound: "teams.teamGone",
          invalid: "teams.addMemberInvalid",
          failedStatus: "teams.addFailedStatus",
          failed: "teams.addFailedNetwork",
        }),
      );
    },
  });

  const removeConfirm = useDeleteConfirm<MemberRow>({
    mutationFn: (row) => removeTeamMember(id, row.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["teamMembersList", id] });
    },
    successMessage: t("teams.toast.memberRemoved"),
  });

  if (!idIsValid) return <Navigate to="/teams" replace />;

  const members = membersPage?.items ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const addOptions = (userPool ?? [])
    .filter((u) => !memberIds.has(u.id) && u.id !== team?.managerId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ value: String(u.id), label: u.name }));

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
          <Button component={RouterLink} to={backTo} variant="default">
            {backLabel}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={backTo} size="sm">
          {backLabel}
        </Anchor>
        <Title order={2}>
          {t("teams.members")}
          {team ? ` — ${team.name}` : ""}
        </Title>
      </Stack>

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
        <Alert color="red" variant="light" title={t("teams.addMemberFailed")} onClose={() => setAddError(null)} withCloseButton>
          {addError}
        </Alert>
      )}

      {membersIsError && (
        <Alert color="red" variant="light" title={t("teams.loadMembersFailed")}>
          {membersError instanceof Error ? membersError.message : t("teams.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("common.field.name")}</Table.Th>
            <Table.Th>{t("common.field.email")}</Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {membersLoading && !membersPage ? (
            <TableLoadingRow colSpan={3} />
          ) : members.length > 0 ? (
            members.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td style={{ maxWidth: 240 }}>
                  <PersonaChip name={m.name} />
                </Table.Td>
                <Table.Td style={{ maxWidth: 280 }}>
                  <Text size="sm" truncate>
                    {m.email}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap" justify="flex-end">
                    {/* The relationship-aware read-only card view — everyone, except one's own
                        row (the card flavors describe the viewer's relationship to someone
                        else); the members origin threads the teamId back here. */}
                    {m.id !== currentUserId && (
                      <Button
                        component={RouterLink}
                        to={userDetailsLink(m.id, m.name, "members", id)}
                        variant="subtle"
                        size="xs"
                        leftSection={<IconId size={14} />}
                        aria-label={t("users.detailsFor", { name: m.name })}
                      >
                        {t("users.details")}
                      </Button>
                    )}
                    {m.id !== currentUserId && hasFeature("FEEDBACKS") && (
                      <FeedbackActionsMenu
                        provideTo={feedbackProvideLink(m.id, m.name)}
                        askTo={feedbackAskLink(m.id, m.name, `/teams/${id}/members`)}
                        listTo={userFeedbacksLink(m.id, m.name, "members", id)}
                        name={m.name}
                      />
                    )}
                    {canManage && (
                      <Button
                        color="red"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => removeConfirm.requestDelete({ id: m.id, name: m.name })}
                        aria-label={t("teams.removeAria", { name: m.name })}
                      >
                        {t("teams.remove")}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : !membersIsError ? (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <EmptyState
                    icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("teams.noMembersYet")}
                  />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      <Text size="sm" c="dimmed">
        {t("common.table.total", { count: members.length })}
      </Text>

      <ConfirmDeleteModal
        confirm={removeConfirm}
        title={t("teams.removeModalTitle")}
        errorTitle={t("teams.removeMemberFailed")}
        unknownError={t("teams.unknownError")}
        confirmLabel={t("teams.remove")}
        body={(row) => (
          <>
            {t("teams.removeConfirmLead")} <strong>{row.name}</strong>{" "}
            {t("teams.removeConfirmMid")} <strong>{team?.name}</strong>?
          </>
        )}
      />
    </Stack>
  );
}
