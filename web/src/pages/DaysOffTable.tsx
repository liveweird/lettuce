import { Alert, Badge, Group, Select, Stack, Text } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBeach, IconTrash } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { deleteDaysOff, listDaysOff, type DaysOffListItem, type DaysOffListView, type DaysOffType, listDaysOffPoolTypes } from "../api/daysoff";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isString, useStoredState } from "../hooks/useStoredState";
import { formatIsoDate, formatIsoWeekday } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import { invalidateDaysOff } from "../utils/daysOffQueries";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";

const BASE_SORT_FIELDS = ["startDate", "endDate", "days", "type", "createdAt"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "userName";

// The Type filter (v3.2.0): any, all paid pools, one paid pool ("pool:<kind id>"), or unpaid.
const POOL_PICK_PREFIX = "pool:";
const isTypeFilter = (v: unknown): v is string | null =>
  v === null || v === "PAID" || v === "UNPAID" || (typeof v === "string" && /^pool:\d+$/.test(v));

/**
 * The days-off entries list (the GoalTable shape): view `own` = the caller's own entries,
 * `managed` = the reports' entries (direct by default, or the whole transitive chain with
 * `includeIndirect` — v3.13.0), `user` = the read-only HR auditor view. There is no approval
 * lifecycle since v3.9.0 — every entry is active from creation, and the only row action is
 * Delete (the owner or any manager in their transitive chain, the server-computed `canDelete`).
 * The person column shows on managed/user (own is caller-implied) and hides when a drill-down
 * pins the user; the unpinned managed view also carries a Team column (v3.13.0) naming each
 * report's teams within the caller's scope.
 */
export default function DaysOffTable({
  view,
  userId,
  settingsKey,
  includeIndirect,
  emptyAction,
}: {
  view: DaysOffListView;
  /** Pin to one user (required with view="user"; the drill-down filter on "managed"). */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** view="managed" only (v2.32.0): widen from direct reports to the whole subtree — the
   * drill-down's chain mode. The Delete action stays honest via the server's canDelete. */
  includeIndirect?: boolean;
  /** The hub page's creation link for the empty state (v3.4.0, see EmptyCtaLink). */
  emptyAction?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const personVisible = view !== "own" && userId == null;
  // The Team column (v3.13.0): each report's teams within the caller's managed scope — only
  // meaningful on the unpinned managed view (a drill-down pinned to one user already names them).
  const teamsVisible = view === "managed" && userId == null;
  const sortFields: readonly SortField[] = personVisible
    ? [...BASE_SORT_FIELDS, "userName"]
    : BASE_SORT_FIELDS;
  const columnCount = sortFields.length + 1 + (teamsVisible ? 1 : 0);

  const storeKey = settingsKey ?? `daysOff.${view}`;
  const [userFilter, setUserFilter] = useStoredState(`${storeKey}.filter.user`, "", isString);
  const [typeFilter, setTypeFilter] = useStoredState<string | null>(
    `${storeKey}.filter.type`, null, isTypeFilter,
  );
  const { data: poolTypes } = useQuery({
    queryKey: ["daysOffPoolTypes"],
    queryFn: listDaysOffPoolTypes,
  });
  // A stored pool pick whose kind was archived since (the registry lists active kinds only)
  // reads as "any" once the registry has loaded, instead of a blank control over a filtered
  // list (v3.2.1).
  const storedPoolId = typeFilter?.startsWith(POOL_PICK_PREFIX)
    ? Number(typeFilter.slice(POOL_PICK_PREFIX.length))
    : undefined;
  const stalePool = storedPoolId != null && poolTypes != null && !poolTypes.some((k) => k.id === storedPoolId);
  const effectiveTypeFilter = stalePool ? null : typeFilter;
  const poolTypeFilter = stalePool ? undefined : storedPoolId;
  const activeFilterCount = (personVisible && userFilter.trim() ? 1 : 0) + (effectiveTypeFilter ? 1 : 0);
  const [debouncedUser] = useDebouncedValue(userFilter, 300);

  const deleteConfirm = useDeleteConfirm<DaysOffListItem>({
    mutationFn: (row) => deleteDaysOff(row.id),
    onSuccess: () => invalidateDaysOff(queryClient),
    successMessage: t("daysOff.toast.deleted"),
  });

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "startDate",
      [debouncedUser, typeFilter],
      { key: storeKey, sortFields },
      "desc", // most recent periods first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "daysOff", view, userId, includeIndirect, page, pageSize, sortParam, debouncedUser,
      effectiveTypeFilter,
    ],
    queryFn: () =>
      listDaysOff({
        view,
        page,
        pageSize,
        sort: sortParam,
        userName: (personVisible && debouncedUser) || undefined,
        type: poolTypeFilter != null ? "PAID" : ((effectiveTypeFilter as DaysOffType | null) ?? undefined),
        poolTypeId: poolTypeFilter,
        userId,
        includeIndirect,
      }),
    placeholderData: keepPreviousData,
    // A stored pool pick waits for the registry (one fetch, never a stale-filtered first page).
    enabled: storedPoolId == null || poolTypes !== undefined,
  });

  function rowActions(r: DaysOffListItem) {
    // The server-computed capability flag (v3.9.0, the team-KPI canManage precedent — the
    // former canCancel): the only remaining action is destructive, so it renders as the
    // tooltipped red primary — the one-action-registries idiom (RowActions doc, web/CLAUDE.md).
    if (!r.canDelete) return null;
    return (
      <RowActions
        primary={{
          icon: <IconTrash size={16} />,
          label: t("common.action.delete"),
          ariaLabel:
            view === "own"
              ? t("daysOff.deleteOwnAria", { date: r.startDate })
              : t("daysOff.deleteForAria", { name: r.userName, date: r.startDate }),
          color: "red",
          onClick: () => deleteConfirm.requestDelete(r),
        }}
      />
    );
  }

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        {personVisible && (
          <ClearableTextInput
            label={t("daysOff.person")}
            value={userFilter}
            onChange={setUserFilter}
            clearLabel={t("daysOff.clearPersonFilter")}
          />
        )}
        <Select
          label={t("daysOff.type.label")}
          data={[
            { value: "", label: t("common.state.any") },
            { value: "PAID", label: t("daysOff.type.PAID") },
            ...(poolTypes ?? []).map((k) => ({ value: `${POOL_PICK_PREFIX}${k.id}`, label: `— ${k.name}` })),
            { value: "UNPAID", label: t("daysOff.type.UNPAID") },
          ]}
          value={effectiveTypeFilter ?? ""}
          onChange={(v) => setTypeFilter(v || null)}
          allowDeselect={false}
          w={200}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("daysOff.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            {personVisible && (
              <ResponsiveTable.Th sortable><SortHeader
                  field="userName"
                  label={t("daysOff.person")}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            )}
            {teamsVisible && <ResponsiveTable.Th>{t("teams.team")}</ResponsiveTable.Th>}
            {(["startDate", "endDate", "days", "type", "createdAt"] as const).map((f) => (
              <ResponsiveTable.Th sortable key={f}><SortHeader
                  field={f}
                  label={t(f === "type" ? "daysOff.type.label" : `daysOff.column.${f}`)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            ))}
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((r) => (
              <ResponsiveTable.Tr key={r.id}>
                {personVisible && (
                  <ResponsiveTable.Td label={t("daysOff.person")}>
                    <PersonCell
                      userId={r.userId}
                      name={r.userName}
                      deleted={r.userDeleted}
                      currentUserId={currentUserId}
                    />
                  </ResponsiveTable.Td>
                )}
                {teamsVisible && (
                  <ResponsiveTable.Td label={t("teams.team")}>
                    <Group gap={4}>
                      {(r.teams ?? []).map((team) => (
                        <Badge key={team.id} variant="light" color="gray">
                          {team.name}
                        </Badge>
                      ))}
                    </Group>
                  </ResponsiveTable.Td>
                )}
                <ResponsiveTable.Td label={t("daysOff.column.startDate")}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm">{formatIsoDate(r.startDate, i18n.language)}</Text>
                    <Text size="xs" c="dimmed" span>
                      {formatIsoWeekday(r.startDate, i18n.language)}
                    </Text>
                    {r.startHalf && (
                      <Text size="xs" c="dimmed" span>
                        {t("daysOff.halfMarker")}
                      </Text>
                    )}
                  </Group>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("daysOff.column.endDate")}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm">{formatIsoDate(r.endDate, i18n.language)}</Text>
                    <Text size="xs" c="dimmed" span>
                      {formatIsoWeekday(r.endDate, i18n.language)}
                    </Text>
                    {r.endHalf && (
                      <Text size="xs" c="dimmed" span>
                        {t("daysOff.halfMarker")}
                      </Text>
                    )}
                  </Group>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("daysOff.column.days")}>
                  {formatDays(r.days, i18n.language)}
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("daysOff.type.label")}>
                  {/* A paid row names its pool (v3.2.0); pre-pool rows and UNPAID keep the type word. */}
                  {r.type === "PAID" ? (r.poolName ?? t("daysOff.type.PAID")) : t("daysOff.type.UNPAID")}
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("daysOff.column.createdAt")}>
                  <DateCell value={r.createdAt} mode="date" />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>{rowActions(r)}</ResponsiveTable.Td>
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconBeach size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("daysOff.noEntries")}
                  action={emptyAction}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="daysOff.rowsPerPage"
      />

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("daysOff.deleteTitle")}
        errorTitle={t("daysOff.deleteFailed")}
        body={() => t("daysOff.deleteMessage")}
        errorMessage={(err) =>
          saveErrorMessage(err, t, {
            forbidden: "daysOff.error.actionPermission",
            notFound: "daysOff.error.gone",
            failedStatus: "daysOff.error.actionFailedStatus",
            failed: "daysOff.error.actionFailed",
          })
        }
      />
    </Stack>
  );
}
