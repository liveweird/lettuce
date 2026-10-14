import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Timeline,
  Title,
} from "@mantine/core";
import { IconHistory, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import { getUserId, isAdmin } from "../api/session";
import {
  createTeamManagerPeriod,
  createTeamMembership,
  deleteTeamManagerPeriod,
  deleteTeamMembership,
  getTeam,
  listTeamManagerPeriods,
  listTeamMemberships,
  updateTeamManagerPeriod,
  updateTeamMembership,
  type TeamManagerPeriod,
  type TeamMembership,
} from "../api/teams";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import DateField from "../components/DateField";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import PersonCell from "../components/PersonCell";
import ResponsiveTable from "../components/ResponsiveTable";
import RowActions from "../components/RowActions";
import TableLoadingRow from "../components/TableLoadingRow";
import TeamPeriodStatusPill from "../components/TeamPeriodStatusPill";
import { activeOnly, renderUserOption, userOption } from "../components/userOptions";
import { useAllUsers } from "../hooks/useAllUsers";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { resolveBackLink } from "../utils/backLink";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { teamDetailsLink } from "../utils/teamLinks";
import { invalidateTeamStructure } from "../utils/teamQueries";
import { periodStatus } from "../utils/teamPeriods";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

// A rejected write explains itself: the server's 400/409 problem `detail` (an overlap, a
// manager who is also a member on another day, a start collision, the only manager period…)
// IS the message. Anything else falls back to the fixed per-status wording.
function writeErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.detail) {
    return err.detail;
  }
  return saveErrorMessage(err, t, {
    forbidden: "teams.history.errorPermission",
    notFound: "teams.history.errorGone",
    conflict: "teams.history.errorConflict",
    invalid: "teams.history.errorInvalid",
    failedStatus: "teams.history.saveFailedStatus",
    failed: "teams.history.saveFailed",
  });
}

// The person Select's options: active people only (the v4.16.0 picker rule), an already-chosen
// person kept — and a person absent from the pool (soft-deleted) still labelled by their row.
function personOptions(
  pool: ReturnType<typeof useAllUsers>["userPool"],
  keep: { id: number; name: string } | null,
  includeInactive = false,
) {
  // A NEW reference never offers a deactivated person (the v4.16.0 picker rule) — except when
  // the admin records a PAST period for someone who has left ("Include inactive people"); the
  // server still refuses anything reaching today or later, and the form shows its 400.
  const candidates = includeInactive ? [...(pool ?? [])] : activeOnly(pool ?? [], keep ? [keep.id] : []);
  const options = candidates
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => userOption(u.id, u.name, (u.teams ?? []).map((team) => team.name)));
  if (keep && !options.some((o) => o.value === String(keep.id))) {
    options.push(userOption(keep.id, keep.name, []));
  }
  return options;
}

function useRangeLabel() {
  const { t, i18n } = useTranslation();
  return (p: { startDate: string | null; endDate: string | null }): string => {
    const start = p.startDate != null ? formatIsoDate(p.startDate, i18n.language) : null;
    const end = p.endDate != null ? formatIsoDate(p.endDate, i18n.language) : null;
    if (start != null && end != null) return `${start} – ${end}`;
    if (start != null) return t("teams.history.since", { date: start });
    if (end != null) return t("teams.history.beforeRecordsUntil", { date: end });
    return t("teams.history.sinceBeforeRecords");
  };
}

type ManagerDraft = { managerId: string; startDate: string };

function ManagerForm({
  initial,
  editing,
  keep,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: ManagerDraft;
  editing: boolean;
  keep: { id: number; name: string } | null;
  submitting: boolean;
  onSubmit: (draft: ManagerDraft) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { userPool, usersError } = useAllUsers();
  const [draft, setDraft] = useState<ManagerDraft>(initial);
  const [includeInactive, setIncludeInactive] = useState(false);
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        {t(editing ? "teams.history.managers.editTitle" : "teams.history.managers.addTitle")}
      </Text>
      <Text size="xs" c="dimmed">
        {t(editing ? "teams.history.managers.editHint" : "teams.history.managers.addHint")}
      </Text>
      <Group align="flex-start" gap="md" wrap="wrap">
        <Select
          withAsterisk
          label={t("common.field.manager")}
          placeholder={t("teams.pickManager")}
          data={personOptions(userPool, keep, includeInactive)}
          renderOption={renderUserOption}
          value={draft.managerId || null}
          onChange={(value) => setDraft((d) => ({ ...d, managerId: value ?? "" }))}
          searchable
          nothingFoundMessage={t("teams.noMatchingUsers")}
          error={usersError ? t("common.error.optionsFailed") : undefined}
          w={260}
        />
        <Checkbox
          mt={28}
          label={t("teams.history.includeInactive")}
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.currentTarget.checked)}
        />
        <DateField
          label={t("teams.history.managers.startsOn")}
          description={t("teams.history.startHint")}
          value={draft.startDate}
          onChange={(iso) => setDraft((d) => ({ ...d, startDate: iso }))}
          w={200}
        />
      </Group>
      <Group justify="flex-end" gap="sm">
        {onCancel != null && (
          <Button variant="default" disabled={submitting} onClick={onCancel}>
            {t("common.action.cancel")}
          </Button>
        )}
        <Button
          leftSection={editing ? undefined : <IconPlus size={16} />}
          onClick={() => onSubmit(draft)}
          loading={submitting}
          disabled={draft.managerId === ""}
        >
          {t(editing ? "common.action.save" : "teams.history.managers.addAction")}
        </Button>
      </Group>
    </Stack>
  );
}

function ManagersSection({ teamId, canManage }: { teamId: number; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const rangeLabel = useRangeLabel();
  const currentUserId = getUserId();
  const [editingId, setEditingId] = useState<number | null>(null);
  // Bumped on a successful add or save only, so an unrelated delete never remounts the form.
  const [formSeq, setFormSeq] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["teamManagerPeriods", teamId],
    queryFn: () => listTeamManagerPeriods(teamId),
  });

  const save = useMutation({
    mutationFn: async ({ id, draft }: { id: number | null; draft: ManagerDraft }) => {
      const body = { managerId: Number(draft.managerId), startDate: draft.startDate || null };
      if (id == null) await createTeamManagerPeriod(teamId, body);
      else await updateTeamManagerPeriod(teamId, id, body);
    },
    onSuccess: async (_result, { id }) => {
      setError(null);
      setEditingId(null);
      setFormSeq((n) => n + 1);
      await invalidateTeamStructure(queryClient, teamId);
      showSuccessToast(t(id == null ? "teams.history.managers.toastAdded" : "teams.history.managers.toastUpdated"));
    },
    onError: (err) => setError(writeErrorMessage(err, t)),
  });

  const removeConfirm = useDeleteConfirm<TeamManagerPeriod>({
    mutationFn: (row) => deleteTeamManagerPeriod(teamId, row.id),
    onSuccess: async (row) => {
      // Deleting the row being edited leaves nothing to edit: back to the add form.
      if (row.id === editingId) setEditingId(null);
      await invalidateTeamStructure(queryClient, teamId);
    },
    successMessage: t("teams.history.managers.toastDeleted"),
  });

  const periods = data ?? [];
  // Server order is chronological; a history surface reads newest first.
  const newestFirst = [...periods].reverse();
  const editing = editingId != null ? periods.find((p) => p.id === editingId) : undefined;

  return (
    <Stack gap="sm" component="section" aria-labelledby="team-history-managers">
      <div>
        <Title order={3} id="team-history-managers">
          {t("teams.history.managers.heading")}
        </Title>
        <Text size="sm" c="dimmed">
          {t("teams.history.managers.hint")}
        </Text>
      </div>

      <Paper withBorder p="md" radius="md">
        {isError ? (
          <Alert color="red" variant="light" title={t("teams.history.loadFailed")}>
            {loadErrorMessage(loadError, t)}
          </Alert>
        ) : isLoading || !data ? (
          <Center py="md">
            <Loader size="sm" />
          </Center>
        ) : newestFirst.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            {t("teams.history.managers.empty")}
          </Text>
        ) : (
          <Timeline active={0} bulletSize={14} lineWidth={2}>
            {newestFirst.map((p) => (
              <Timeline.Item
                key={p.id}
                title={
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm" fw={600} span>
                      {rangeLabel(p)}
                    </Text>
                    {p.current && (
                      <Badge size="sm" variant="light" color="lettuce">
                        {t("teams.history.currentBadge")}
                      </Badge>
                    )}
                  </Group>
                }
              >
                <Stack gap={2} mt={2}>
                  <PersonCell
                    userId={p.managerId}
                    name={p.managerName}
                    deleted={p.managerDeleted}
                    currentUserId={currentUserId}
                  />
                  {canManage && (
                    <Group gap={4} mt={4}>
                      <Button
                        variant="subtle"
                        size="xs"
                        leftSection={<IconPencil size={14} />}
                        disabled={save.isPending}
                        onClick={() => {
                          setError(null);
                          setEditingId(p.id);
                        }}
                        aria-label={t("teams.history.managers.editAria", { name: p.managerName, range: rangeLabel(p) })}
                      >
                        {t("common.action.edit")}
                      </Button>
                      <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        disabled={save.isPending}
                        onClick={() => removeConfirm.requestDelete(p)}
                        aria-label={t("teams.history.managers.deleteAria", {
                          name: p.managerName,
                          range: rangeLabel(p),
                        })}
                      >
                        {t("common.action.delete")}
                      </Button>
                    </Group>
                  )}
                </Stack>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Paper>

      {canManage && error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {canManage && (
        <Paper withBorder p="md" radius="md">
          <ManagerForm
            // Remounting IS the prefill: a fresh key on entering/leaving edit mode or after a
            // write's refetch reseeds the fields; background refetches keep in-progress input.
            key={editing != null ? `edit-${editing.id}-${editing.managerId}-${editing.startDate}` : `add-${formSeq}`}
            initial={{
              managerId: editing != null ? String(editing.managerId) : "",
              startDate: editing != null ? (editing.startDate ?? "") : todayIsoDate(),
            }}
            editing={editing != null}
            keep={editing != null ? { id: editing.managerId, name: editing.managerName } : null}
            submitting={save.isPending}
            onSubmit={(draft) => save.mutate({ id: editing?.id ?? null, draft })}
            onCancel={editing != null ? () => setEditingId(null) : undefined}
          />
        </Paper>
      )}

      <ConfirmDeleteModal
        confirm={removeConfirm}
        title={t("teams.history.managers.deleteTitle")}
        errorTitle={t("teams.history.managers.deleteFailed")}
        errorMessage={(err) => writeErrorMessage(err, t)}
        body={(row) =>
          t("teams.history.managers.deleteMessage", { name: row.managerName, range: rangeLabel(row) })
        }
      />
    </Stack>
  );
}

type MembershipDraft = { userId: string; startDate: string; endDate: string };

function MembershipForm({
  initial,
  editing,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: MembershipDraft;
  editing: TeamMembership | undefined;
  submitting: boolean;
  onSubmit: (draft: MembershipDraft) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { userPool, usersError } = useAllUsers(editing == null);
  const [draft, setDraft] = useState<MembershipDraft>(initial);
  const [includeInactive, setIncludeInactive] = useState(false);
  const endsBeforeStart = draft.startDate !== "" && draft.endDate !== "" && draft.endDate < draft.startDate;
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        {t(editing ? "teams.history.members.editTitle" : "teams.history.members.addTitle")}
      </Text>
      <Text size="xs" c="dimmed">
        {t(editing ? "teams.history.members.editHint" : "teams.history.members.addHint")}
      </Text>
      <Group align="flex-start" gap="md" wrap="wrap">
        {editing ? (
          // The person is fixed once a period exists — correct dates only.
          <div>
            <Text size="sm" fw={500}>
              {t("teams.history.members.person")}
            </Text>
            <Text size="sm" mt={6}>
              {editing.userName}
            </Text>
          </div>
        ) : (
          <Select
            withAsterisk
            label={t("teams.history.members.person")}
            placeholder={t("teams.pickUser")}
            data={personOptions(userPool, null, includeInactive)}
            renderOption={renderUserOption}
            value={draft.userId || null}
            onChange={(value) => setDraft((d) => ({ ...d, userId: value ?? "" }))}
            searchable
            nothingFoundMessage={t("teams.noMatchingUsers")}
            error={usersError ? t("common.error.optionsFailed") : undefined}
            w={260}
          />
        )}
        {editing == null && (
          <Checkbox
            mt={28}
            label={t("teams.history.includeInactive")}
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.currentTarget.checked)}
          />
        )}
        <DateField
          label={t("teams.history.members.from")}
          description={t("teams.history.startHint")}
          value={draft.startDate}
          onChange={(iso) => setDraft((d) => ({ ...d, startDate: iso }))}
          w={200}
        />
        <DateField
          label={t("teams.history.members.until")}
          description={t("teams.history.endHint")}
          value={draft.endDate}
          onChange={(iso) => setDraft((d) => ({ ...d, endDate: iso }))}
          w={200}
        />
      </Group>
      {endsBeforeStart && (
        <Text size="xs" c="red">
          {t("teams.history.members.endBeforeStart")}
        </Text>
      )}
      <Group justify="flex-end" gap="sm">
        {onCancel != null && (
          <Button variant="default" disabled={submitting} onClick={onCancel}>
            {t("common.action.cancel")}
          </Button>
        )}
        <Button
          leftSection={editing ? undefined : <IconPlus size={16} />}
          onClick={() => onSubmit(draft)}
          loading={submitting}
          disabled={(editing == null && draft.userId === "") || endsBeforeStart}
        >
          {t(editing ? "common.action.save" : "teams.history.members.addAction")}
        </Button>
      </Group>
    </Stack>
  );
}

function MembershipsSection({ teamId, canManage }: { teamId: number; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const rangeLabel = useRangeLabel();
  const currentUserId = getUserId();
  const today = todayIsoDate();
  const [editingId, setEditingId] = useState<number | null>(null);
  // Bumped on a successful add or save only, so an unrelated delete never remounts the form.
  const [formSeq, setFormSeq] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["teamMemberships", teamId],
    queryFn: () => listTeamMemberships(teamId),
  });

  const save = useMutation({
    mutationFn: async ({ id, draft }: { id: number | null; draft: MembershipDraft }) => {
      const dates = { startDate: draft.startDate || null, endDate: draft.endDate || null };
      if (id == null) await createTeamMembership(teamId, { userId: Number(draft.userId), ...dates });
      else await updateTeamMembership(teamId, id, dates);
    },
    onSuccess: async (_result, { id }) => {
      setError(null);
      setEditingId(null);
      setFormSeq((n) => n + 1);
      await invalidateTeamStructure(queryClient, teamId);
      showSuccessToast(t(id == null ? "teams.history.members.toastAdded" : "teams.history.members.toastUpdated"));
    },
    onError: (err) => setError(writeErrorMessage(err, t)),
  });

  const removeConfirm = useDeleteConfirm<TeamMembership>({
    mutationFn: (row) => deleteTeamMembership(teamId, row.id),
    onSuccess: async (row) => {
      if (row.id === editingId) setEditingId(null);
      await invalidateTeamStructure(queryClient, teamId);
    },
    successMessage: t("teams.history.members.toastDeleted"),
  });

  const memberships = data ?? [];
  // Server order is oldest first (a null start leads); newest first reads naturally here.
  const newestFirst = [...memberships].reverse();
  const editing = editingId != null ? memberships.find((m) => m.id === editingId) : undefined;
  const colCount = canManage ? 5 : 4;

  return (
    <Stack gap="sm" component="section" aria-labelledby="team-history-members">
      <div>
        <Title order={3} id="team-history-members">
          {t("teams.history.members.heading")}
        </Title>
        <Text size="sm" c="dimmed">
          {t("teams.history.members.hint")}
        </Text>
      </div>

      {isError && (
        <Alert color="red" variant="light" title={t("teams.history.loadFailed")}>
          {loadErrorMessage(loadError, t)}
        </Alert>
      )}

      <ResponsiveTable density="normal">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th>{t("teams.history.members.person")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("teams.history.members.from")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("teams.history.members.until")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("common.field.status")}</ResponsiveTable.Th>
            {canManage && <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />}
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={colCount} />
          ) : newestFirst.length > 0 ? (
            newestFirst.map((m) => (
              <ResponsiveTable.Tr key={m.id}>
                <ResponsiveTable.Td label={t("teams.history.members.person")} primary>
                  <PersonCell
                    userId={m.userId}
                    name={m.userName}
                    deleted={m.userDeleted}
                    currentUserId={currentUserId}
                  />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("teams.history.members.from")}>
                  {m.startDate != null
                    ? formatIsoDate(m.startDate, i18n.language)
                    : t("teams.history.beforeRecordsShort")}
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("teams.history.members.until")}>
                  {m.endDate != null ? formatIsoDate(m.endDate, i18n.language) : t("teams.history.noEnd")}
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("common.field.status")}>
                  <TeamPeriodStatusPill status={periodStatus(m, today)} />
                </ResponsiveTable.Td>
                {canManage && (
                  <ResponsiveTable.Td actions>
                    <RowActions
                      name={m.userName}
                      primary={{
                        icon: <IconPencil size={16} />,
                        label: t("common.action.edit"),
                        ariaLabel: t("teams.history.members.editAria", { name: m.userName, range: rangeLabel(m) }),
                        onClick: () => {
                          setError(null);
                          setEditingId(m.id);
                        },
                      }}
                      items={[
                        {
                          icon: <IconTrash size={16} />,
                          label: t("common.action.delete"),
                          ariaLabel: t("teams.history.members.deleteAria", {
                            name: m.userName,
                            range: rangeLabel(m),
                          }),
                          color: "red",
                          onClick: () => removeConfirm.requestDelete(m),
                        },
                      ]}
                    />
                  </ResponsiveTable.Td>
                )}
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={colCount}>
                <EmptyState
                  icon={<IconHistory size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("teams.history.members.empty")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      {canManage && error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {canManage && (
        <Paper withBorder p="md" radius="md">
          <MembershipForm
            key={editing != null ? `edit-${editing.id}-${editing.startDate}-${editing.endDate}` : `add-${formSeq}`}
            initial={{
              userId: "",
              startDate: editing != null ? (editing.startDate ?? "") : today,
              endDate: editing != null ? (editing.endDate ?? "") : "",
            }}
            editing={editing}
            submitting={save.isPending}
            onSubmit={(draft) => save.mutate({ id: editing?.id ?? null, draft })}
            onCancel={editing != null ? () => setEditingId(null) : undefined}
          />
        </Paper>
      )}

      <ConfirmDeleteModal
        confirm={removeConfirm}
        title={t("teams.history.members.deleteTitle")}
        errorTitle={t("teams.history.members.deleteFailed")}
        errorMessage={(err) => writeErrorMessage(err, t)}
        body={(row) =>
          t("teams.history.members.deleteMessage", { name: row.userName, range: rangeLabel(row) })
        }
      />
    </Stack>
  );
}

/**
 * The team's dated structure (`/teams/:id/history`, v4.17.0): the manager succession line as a
 * timeline and every membership period as a table, newest first. Readable by any authenticated
 * caller; ADMINs also get the add/correct/delete forms (the server enforces both — rights always
 * follow today's structure, this page is the record). Back returns to the team details, or to
 * the page that sent us here (`?back=`).
 */
export default function TeamHistory() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const canManage = isAdmin();

  const { data: team, isLoading, isError, error } = useQuery({
    queryKey: ["team", id],
    queryFn: () => getTeam(id),
    enabled: idIsValid,
  });

  if (!idIsValid) return <Navigate to="/teams" replace />;

  const resolvedBack = resolveBackLink({
    backOverride: safeBackParam(searchParams),
    defaultTo: teamDetailsLink(id),
  });
  const back = { to: resolvedBack.to, label: t("feedback.backToLabel", { label: t(resolvedBack.labelKey) }) };

  if (isLoading) {
    return (
      <Stack gap="md">
        <Title order={2}>{t("teams.history.pageTitle")}</Title>
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (isError || !team) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Stack gap="md">
        <Title order={2}>{t("teams.history.pageTitle")}</Title>
        <Alert color="red" variant="light">
          {notFound ? t("teams.teamNotFound") : t("teams.loadTeamFailed", { suffix: error instanceof ApiError ? ` (${error.status})` : "" })}
        </Alert>
        <Group justify="flex-end">
          <Button component={RouterLink} to={back.to} variant="default">
            {back.label}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader
        back={back}
        title={t("teams.history.title", { name: team.name })}
        description={t("teams.history.description")}
      />
      <ManagersSection teamId={id} canManage={canManage} />
      <MembershipsSection teamId={id} canManage={canManage} />
    </Stack>
  );
}
