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
  Text,
  Title,
} from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconTrash, IconUsersGroup } from "@tabler/icons-react";
import { ApiError } from "../api/http";
import { getUserId, isAdmin } from "../api/session";
import { getUser, getUserTeamHistory, type UserTeamPeriod } from "../api/users";
import { addTeamMember, listAllTeams, removeTeamMember } from "../api/teams";
import { userDetailsLink } from "../utils/userLinks";
import { teamDetailsLink, teamHistoryLink } from "../utils/teamLinks";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { newestFirstPeriods, periodStatus } from "../utils/teamPeriods";
import { showSuccessToast } from "../utils/toast";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import TeamPeriodStatusPill from "../components/TeamPeriodStatusPill";
import PersonaChip from "../components/PersonaChip";
import RowActions from "../components/RowActions";
import { useCurrentPath } from "../hooks/useCurrentPath";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { useUserDisplayName } from "../hooks/useDashboardDrillDown";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";

type TeamRow = { id: number; name: string };

// One read-only table of a person's dated team periods (memberships or managed teams): the team
// (linking to its history page — a deleted team stays plain text with the "(deleted)" tag),
// when the period began and ended, and the Current / Past / Upcoming pill.
function TeamPeriodsTable({
  periods,
  emptyLabel,
}: {
  /** Undefined while the history is loading. */
  periods: UserTeamPeriod[] | undefined;
  emptyLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const here = useCurrentPath();
  const today = todayIsoDate();
  return (
    <ResponsiveTable density="normal">
      <ResponsiveTable.Thead>
        <ResponsiveTable.Tr>
          <ResponsiveTable.Th>{t("users.team")}</ResponsiveTable.Th>
          <ResponsiveTable.Th>{t("users.teamHistory.from")}</ResponsiveTable.Th>
          <ResponsiveTable.Th>{t("users.teamHistory.until")}</ResponsiveTable.Th>
          <ResponsiveTable.Th>{t("common.field.status")}</ResponsiveTable.Th>
        </ResponsiveTable.Tr>
      </ResponsiveTable.Thead>
      <ResponsiveTable.Tbody>
        {periods == null ? (
          <TableLoadingRow colSpan={4} />
        ) : periods.length === 0 ? (
          <ResponsiveTable.Tr>
            <ResponsiveTable.Td colSpan={4}>
              <EmptyState
                icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                label={emptyLabel}
              />
            </ResponsiveTable.Td>
          </ResponsiveTable.Tr>
        ) : (
          newestFirstPeriods(periods).map((p) => (
            <ResponsiveTable.Tr key={p.id}>
              <ResponsiveTable.Td label={t("users.team")} primary>
                {p.team.deleted ? (
                  <Text size="sm" c="dimmed">
                    {p.team.name} {t("users.deletedTag")}
                  </Text>
                ) : (
                  <Anchor
                    component={RouterLink}
                    to={teamHistoryLink(p.team.id, { back: here })}
                    size="sm"
                    aria-label={t("teams.history.openFor", { name: p.team.name })}
                  >
                    {p.team.name}
                  </Anchor>
                )}
              </ResponsiveTable.Td>
              <ResponsiveTable.Td label={t("users.teamHistory.from")}>
                {p.startDate != null
                  ? formatIsoDate(p.startDate, i18n.language)
                  : t("teams.history.beforeRecordsShort")}
              </ResponsiveTable.Td>
              <ResponsiveTable.Td label={t("users.teamHistory.until")}>
                {p.endDate != null ? formatIsoDate(p.endDate, i18n.language) : t("teams.history.noEnd")}
              </ResponsiveTable.Td>
              <ResponsiveTable.Td label={t("common.field.status")}>
                <TeamPeriodStatusPill status={periodStatus(p, today)} />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ))
        )}
      </ResponsiveTable.Tbody>
    </ResponsiveTable>
  );
}

export default function UserTeams() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const here = useCurrentPath();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const queryClient = useQueryClient();
  // Non-admins get a read-only list: no add picker, no remove buttons.
  const canManage = isAdmin();
  // getUser is self-or-admin only, so non-admins can't fetch another user's record — the name
  // resolves from the org-wide user pool by id (the drill-down rule, v3.5.0); the ?name= param
  // the /users list passes is only the pre-load hint.
  const [searchParams] = useSearchParams();
  const pooledName = useUserDisplayName(id, searchParams.get("name"), idIsValid);
  const backLink = { to: "/users", label: t("feedback.backToLabel", { label: t("users.title") }) };

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
    data: allMemberTeams,
    isLoading: teamsLoading,
    isError: teamsIsError,
    error: teamsError,
  } = useQuery({
    queryKey: ["userTeams", id],
    // ALL pages (the single-page-picker lesson): a single page of 100 would hide
    // memberships 101+ from the list AND wrongly offer those teams as addable.
    queryFn: () => listAllTeams({ memberId: id }),
    enabled: idIsValid,
  });

  const {
    data: teamHistory,
    isError: historyIsError,
    error: historyError,
  } = useQuery({
    queryKey: ["userTeamHistory", id],
    queryFn: () => getUserTeamHistory(id),
    enabled: idIsValid,
  });

  const { data: allTeams } = useQuery({
    queryKey: ["teams", "all"],
    queryFn: () => listAllTeams(),
    enabled: idIsValid && canManage,
  });

  const addMutation = useMutation({
    mutationFn: (teamId: number) => addTeamMember(teamId, id),
    onSuccess: async () => {
      setSelectedTeam(null);
      setAddError(null);
      await queryClient.invalidateQueries({ queryKey: ["userTeams", id] });
      await queryClient.invalidateQueries({ queryKey: ["userTeamHistory", id] });
      showSuccessToast(t("teams.toast.memberAdded"));
    },
    onError: (err) => {
      setAddError(
        saveErrorMessage(err, t, {
          forbidden: "users.noPermissionModifyTeam",
          notFound: "users.teamNoLongerExists",
          invalid: "users.cannotAddToTeam",
          failedStatus: "users.addFailedStatus",
          failed: "users.addFailedNetwork",
        }),
      );
    },
  });

  const removeConfirm = useDeleteConfirm<TeamRow>({
    mutationFn: (row) => removeTeamMember(row.id, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["userTeams", id] });
      await queryClient.invalidateQueries({ queryKey: ["userTeamHistory", id] });
    },
    successMessage: t("teams.toast.memberRemoved"),
  });

  if (!idIsValid) return <Navigate to="/users" replace />;

  const displayName = user?.name ?? pooledName;
  const memberTeams = allMemberTeams ?? [];
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
            : t("users.loadUserFailed", {
                suffix: userError instanceof ApiError ? ` (${userError.status})` : "",
              })}
        </Alert>
        <Group justify="flex-end">
          <Button component={RouterLink} to={backLink.to} variant="default">
            {backLink.label}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <PageHeader
        back={backLink}
        title={`${t("users.teams")}${displayName ? ` — ${displayName}` : ""}`}
      />

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
        <Alert color="red" variant="light" title={t("users.addToTeamFailed")} onClose={() => setAddError(null)} withCloseButton>
          {addError}
        </Alert>
      )}

      {teamsIsError && (
        <Alert color="red" variant="light" title={t("users.loadTeamsFailed")}>
          {loadErrorMessage(teamsError, t)}
        </Alert>
      )}

      <ResponsiveTable density="normal">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th>{t("users.team")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("common.field.manager")}</ResponsiveTable.Th>
            {canManage && <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />}
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {teamsLoading && !allMemberTeams ? (
            <TableLoadingRow colSpan={canManage ? 3 : 2} />
          ) : memberTeams.length > 0 ? (
            memberTeams.map((team) => (
              <ResponsiveTable.Tr key={team.id}>
                <ResponsiveTable.Td label={t("users.team")} primary>
                  {/* The team name links to the team-details view (the v2.5.4 convention). */}
                  <Anchor
                    component={RouterLink}
                    to={teamDetailsLink(team.id, { back: here })}
                    size="sm"
                    aria-label={t("teams.detailsForAria", { name: team.name })}
                  >
                    {team.name}
                  </Anchor>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("common.field.manager")}>
                  {team.managerDeleted ? (
                    <Text size="sm" c="dimmed">
                      {team.managerName} {t("users.deletedTag")}
                    </Text>
                  ) : (
                    // The manager's name links to their details (the /users and /teams rule:
                    // one's own persona stays a plain chip). Returns HERE (v4.6.0 `back=`, no
                    // `from` — the label follows the destination).
                    <PersonaChip
                      name={team.managerName}
                      to={
                        team.managerId !== getUserId()
                          ? userDetailsLink(team.managerId, team.managerName, undefined, undefined, { back: here })
                          : undefined
                      }
                      ariaLabel={t("users.detailsFor", { name: team.managerName })}
                    />
                  )}
                </ResponsiveTable.Td>
                {canManage && (
                  <ResponsiveTable.Td actions>
                    <RowActions
                      primary={{
                        icon: <IconTrash size={16} />,
                        label: t("users.remove"),
                        ariaLabel: t("users.removeFromAria", { name: team.name }),
                        color: "red",
                        onClick: () => removeConfirm.requestDelete({ id: team.id, name: team.name }),
                      }}
                    />
                  </ResponsiveTable.Td>
                )}
              </ResponsiveTable.Tr>
            ))
          ) : !teamsIsError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={canManage ? 3 : 2}>
                <EmptyState
                    icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("users.notMemberOfAnyTeam")}
                  />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <Text size="sm" c="dimmed">
        {t("common.table.total", { count: memberTeams.length })}
      </Text>

      {/* The read-only dated history (v4.17.0): past and upcoming periods too. Rows link to the
          team's history page, where an ADMIN corrects them. */}
      <Stack gap="sm" component="section" aria-labelledby="user-team-history">
        <div>
          <Title order={3} id="user-team-history">
            {t("users.teamHistory.heading")}
          </Title>
          <Text size="sm" c="dimmed">
            {t("users.teamHistory.hint")}
          </Text>
        </div>
        {historyIsError ? (
          <Alert color="red" variant="light" title={t("users.teamHistory.loadFailed")}>
            {loadErrorMessage(historyError, t)}
          </Alert>
        ) : (
          <>
            <Text size="sm" fw={600}>
              {t("users.teamHistory.memberships")}
            </Text>
            <TeamPeriodsTable
              periods={teamHistory?.memberships}
              emptyLabel={t("users.teamHistory.noMemberships")}
            />
            <Text size="sm" fw={600}>
              {t("users.teamHistory.managed")}
            </Text>
            <TeamPeriodsTable
              periods={teamHistory?.managerPeriods}
              emptyLabel={t("users.teamHistory.noManaged")}
            />
          </>
        )}
      </Stack>

      <ConfirmDeleteModal
        confirm={removeConfirm}
        title={t("users.removeTitle")}
        errorTitle={t("users.removeFromTeamFailed")}
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
