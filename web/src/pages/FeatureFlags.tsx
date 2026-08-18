import { useState } from "react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { Alert, Badge, Button, Group, Select, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmActionModal from "../components/ConfirmActionModal";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonaChip from "../components/PersonaChip";
import SortHeader from "../components/SortHeader";
import { useBulkFeatureUpdate } from "../hooks/useBulkFeatureUpdate";
import { usePagedSort } from "../hooks/usePagedSort";
import { isNumberOrNull, isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { FEATURES, getUserId, isAdmin, type Feature } from "../api/session";
import { listUsers, updateUserFeatures, type UserPage } from "../api/users";
import { listAllTeams } from "../api/teams";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";
import { teamDetailsLink } from "../utils/teamLinks";
import { userDetailsLink } from "../utils/userLinks";
import { invalidateUser } from "../utils/userQueries";

const SORT_FIELDS = ["id", "name", "email"] as const;
type SortField = (typeof SORT_FIELDS)[number];

type UserRow = UserPage["items"][number];

const SETTINGS_KEY = "featureFlags";

// The per-feature admin screen (v1.53.0): pick a feature, see every user with an
// enabled/disabled switch, optionally filtered by state — the flag-first counterpart of the
// per-user editor at /users/:id/features. The state filter "any" deliberately sends NEITHER
// list param (the server requires feature+featureEnabled as a pair); the switch state always
// comes from each row's own disabledFeatures. v2.1.0 adds the team dimension — a member-of
// team filter + badge column (the users-list `teams` enrichment) and bulk enable/disable
// acting on EVERY row matching the current filters (not just the visible page), behind a
// count-stating confirm.
export default function FeatureFlags() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const [feature, setFeature] = useStoredState<Feature>(
    `${SETTINGS_KEY}.feature`,
    "FEEDBACKS",
    isOneOf(FEATURES),
  );
  const [stateFilter, setStateFilter] = useStoredState<string | null>(
    `${SETTINGS_KEY}.filter.state`,
    null,
    isOneOfOrNull(["enabled", "disabled"]),
  );
  const [teamFilter, setTeamFilter] = useStoredState<number | null>(
    `${SETTINGS_KEY}.filter.team`,
    null,
    isNumberOrNull,
  );
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [emailFilter, setEmailFilter] = useStoredState(`${SETTINGS_KEY}.filter.email`, "", isString);
  const activeFilterCount =
    (stateFilter ? 1 : 0) +
    (teamFilter != null ? 1 : 0) +
    (nameFilter.trim() ? 1 : 0) +
    (emailFilter.trim() ? 1 : 0);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);
  const [error, setError] = useState<string | null>(null);
  // The row whose toggle PUT is in flight — its switch disables until the refetch lands.
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [feature, stateFilter, teamFilter, debouncedName, debouncedEmail], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS,
    });

  const teams = useQuery({ queryKey: ["teams", "all"], queryFn: () => listAllTeams(), enabled: isAdmin() });

  const listQuery = (p: number, size: number) =>
    listUsers({
      page: p,
      pageSize: size,
      sort: sortParam,
      name: debouncedName || undefined,
      email: debouncedEmail || undefined,
      teamId: teamFilter ?? undefined,
      feature: stateFilter == null ? undefined : feature,
      featureEnabled: stateFilter == null ? undefined : stateFilter === "enabled",
    });

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: [
      "users",
      "featureFlags",
      page,
      pageSize,
      sortParam,
      feature,
      stateFilter,
      teamFilter,
      debouncedName,
      debouncedEmail,
    ],
    queryFn: () => listQuery(page, pageSize),
    placeholderData: keepPreviousData,
    enabled: isAdmin(),
  });

  // The bulk state machine lives in the hook; this page supplies the fetch (every row
  // matching the CURRENT filters, paged to the server total), the affected predicate
  // (rows not already in the target state), the per-row PUT, and the terminals.
  const bulk = useBulkFeatureUpdate<UserRow>({
    fetchAll: async () => {
      setError(null);
      const rows: UserRow[] = [];
      let p = 1;
      for (;;) {
        const result = await listQuery(p, 100);
        rows.push(...result.items);
        if (rows.length >= result.total || result.items.length === 0) return rows;
        p += 1;
      }
    },
    isAffected: (u, targetEnabled) => u.disabledFeatures.includes(feature) === targetEnabled,
    applyOne: (row, targetEnabled) =>
      updateUserFeatures(
        row.id,
        targetEnabled
          ? row.disabledFeatures.filter((f) => f !== feature)
          : [...row.disabledFeatures, feature],
      ),
    onNothingToDo: () => showSuccessToast(t("users.featureFlags.bulkNoChange")),
    onDone: async (failed, total) => {
      await invalidateUser(queryClient);
      if (failed > 0) {
        setError(t("users.featureFlags.bulkFailed", { count: failed, total }));
      } else {
        showSuccessToast(t("users.toast.featuresSaved"));
      }
    },
    onPrepareError: (err) => {
      setError(
        saveErrorMessage(err, t, {
          failedStatus: "users.featuresFailedStatus",
          failed: "users.featuresFailedNetwork",
        }),
      );
    },
  });

  if (!isAdmin()) return <Navigate to="/" replace />;

  async function toggle(row: { id: number; name: string; disabledFeatures: Feature[] }) {
    const currentlyEnabled = !row.disabledFeatures.includes(feature);
    const next = currentlyEnabled
      ? [...row.disabledFeatures, feature]
      : row.disabledFeatures.filter((f) => f !== feature);
    setError(null);
    setPendingId(row.id);
    try {
      await updateUserFeatures(row.id, next);
      await invalidateUser(queryClient, row.id);
      showSuccessToast(t("users.toast.featuresSaved"));
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "users.noPermissionFeatures",
          notFound: "users.userNoLongerExists",
          failedStatus: "users.featuresFailedStatus",
          failed: "users.featuresFailedNetwork",
        }),
      );
    } finally {
      setPendingId(null);
    }
  }

  const total = data?.total ?? 0;
  const columnCount = 4;
  const featureLabel = t(`common.feature.${feature}`);

  return (
    <Stack gap="md">
      <Title order={2} data-tour="config-feature-flags">
        {t("users.featureFlags.title")}
      </Title>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <Select
          label={t("users.featureFlags.featureLabel")}
          value={feature}
          onChange={(v) => {
            if (v != null) setFeature(v as Feature);
          }}
          allowDeselect={false}
          data={FEATURES.map((f) => ({ value: f, label: t(`common.feature.${f}`) }))}
        />
        <Select
          label={t("users.featureFlags.stateLabel")}
          value={stateFilter}
          onChange={setStateFilter}
          clearable
          placeholder={t("common.state.any")}
          data={[
            { value: "enabled", label: t("users.featureFlags.stateEnabled") },
            { value: "disabled", label: t("users.featureFlags.stateDisabled") },
          ]}
        />
        <Select
          label={t("users.featureFlags.teamLabel")}
          value={teamFilter == null ? null : String(teamFilter)}
          onChange={(v) => setTeamFilter(v == null ? null : Number(v))}
          clearable
          searchable
          placeholder={t("common.state.any")}
          data={(teams.data ?? []).map((team) => ({ value: String(team.id), label: team.name }))}
        />
        <ClearableTextInput
          label={t("common.field.name")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("users.clearNameFilter")}
        />
        <ClearableTextInput
          label={t("common.field.email")}
          value={emailFilter}
          onChange={setEmailFilter}
          clearLabel={t("users.clearEmailFilter")}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("users.loadUsersFailed")}>
          {loadError instanceof Error ? loadError.message : t("users.unknownError")}
        </Alert>
      )}
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Group justify="flex-end" gap="sm">
        <Button
          variant="light"
          loading={bulk.preparing === true}
          disabled={bulk.preparing !== null || total === 0}
          onClick={() => void bulk.prepare(true)}
        >
          {t("users.featureFlags.bulkEnable")}
        </Button>
        <Button
          variant="light"
          color="red"
          loading={bulk.preparing === false}
          disabled={bulk.preparing !== null || total === 0}
          onClick={() => void bulk.prepare(false)}
        >
          {t("users.featureFlags.bulkDisable")}
        </Button>
      </Group>

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
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
            <Table.Th>
              <SortHeader
                field="email"
                label={t("common.field.email")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>{t("users.featureFlags.teamsHeader")}</Table.Th>
            <Table.Th style={{ width: 1, whiteSpace: "nowrap" }}>
              {t("users.featureFlags.enabledHeader")}
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  {/* The name links to the read-only details view — everyone except one's
                      own row (the Users-list rule). */}
                  <PersonaChip
                    name={u.name}
                    to={u.id !== currentUserId ? userDetailsLink(u.id, u.name, "users") : undefined}
                    ariaLabel={t("users.detailsFor", { name: u.name })}
                  />
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{u.email}</Text>
                </Table.Td>
                <Table.Td>
                  {u.teams && u.teams.length > 0 ? (
                    <Group gap={4}>
                      {u.teams.map((team) => (
                        <Badge
                          key={team.id}
                          component={RouterLink}
                          to={teamDetailsLink(team.id)}
                          aria-label={t("teams.detailsForAria", { name: team.name })}
                          variant="light"
                          size="sm"
                          style={{ cursor: "pointer" }}
                        >
                          {team.name}
                        </Badge>
                      ))}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group justify="center">
                    <Switch
                      checked={!u.disabledFeatures.includes(feature)}
                      disabled={pendingId === u.id}
                      onChange={() => void toggle(u)}
                      aria-label={t("users.featureFlags.toggleAria", {
                        feature: featureLabel,
                        name: u.name,
                      })}
                    />
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("users.noUsers")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="users.rowsPerPage"
      />

      <ConfirmActionModal
        opened={bulk.pending != null}
        onClose={bulk.cancel}
        title={t("users.featureFlags.bulkTitle")}
        message={t(
          bulk.pending?.target
            ? "users.featureFlags.bulkConfirmEnable"
            : "users.featureFlags.bulkConfirmDisable",
          { count: bulk.pending?.rows.length ?? 0, feature: featureLabel },
        )}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={
          bulk.pending?.target
            ? t("users.featureFlags.enableAction")
            : t("users.featureFlags.disableAction")
        }
        onConfirm={() => void bulk.run()}
        loading={bulk.running}
        confirmColor={bulk.pending?.target ? "lettuce" : "red"}
      />
    </Stack>
  );
}
