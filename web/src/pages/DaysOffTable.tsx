import type { ParseKeys } from "i18next";
import { useState } from "react";
import { ActionIcon, Alert, Button, Group, Popover, Select, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBeach, IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId } from "../api/session";
import { acceptDaysOff, cancelDaysOff, listDaysOff, rejectDaysOff, type DaysOffListItem, type DaysOffListView, type DaysOffStatus, type DaysOffType, listDaysOffPoolTypes } from "../api/daysoff";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DaysOffCancelModal from "../components/DaysOffCancelModal";
import DaysOffStatusBadge from "../components/DaysOffStatusBadge";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { formatDate, formatIsoDate, formatIsoWeekday, formatTimestamp } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import { invalidateDaysOff } from "../utils/daysOffQueries";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const BASE_SORT_FIELDS = ["startDate", "endDate", "days", "type", "status", "createdAt"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "userName";

const STATUS_VALUES = ["REQUESTED", "ACCEPTED", "REJECTED", "CANCELLED"] as const;
// The Type filter (v3.2.0): any, all paid pools, one paid pool ("pool:<kind id>"), or unpaid.
const POOL_PICK_PREFIX = "pool:";
const isTypeFilter = (v: unknown): v is string | null =>
  v === null || v === "PAID" || v === "UNPAID" || (typeof v === "string" && /^pool:\d+$/.test(v));

// A confirmation-gated row action in flight (reject/cancel open the modal first).
type PendingAction = { kind: "reject" | "cancel"; id: number };

/**
 * The days-off requests list (the GoalTable shape): view `own` = the caller's requests with
 * their Cancel action, `managed` = the direct reports' requests with the manager's
 * Accept/Reject actions, `user` = the read-only HR auditor view. The person column shows on
 * managed/user (own is caller-implied) and hides when a drill-down pins the user.
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
   * drill-down's chain mode. Row actions stay honest via the server's canResolve/canCancel. */
  includeIndirect?: boolean;
  /** The hub page's creation link for the empty state (v3.4.0, see EmptyCtaLink). */
  emptyAction?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const personVisible = view !== "own" && userId == null;
  const sortFields: readonly SortField[] = personVisible
    ? [...BASE_SORT_FIELDS, "userName"]
    : BASE_SORT_FIELDS;
  const columnCount = sortFields.length + 1;

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
  const [statusFilter, setStatusFilter] = useStoredState<DaysOffStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const activeFilterCount =
    (personVisible && userFilter.trim() ? 1 : 0) + (effectiveTypeFilter ? 1 : 0) + (statusFilter ? 1 : 0);
  const [debouncedUser] = useDebouncedValue(userFilter, 300);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "startDate",
      [debouncedUser, typeFilter, statusFilter],
      { key: storeKey, sortFields },
      "desc", // most recent periods first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "daysOff", view, userId, includeIndirect, page, pageSize, sortParam, debouncedUser,
      effectiveTypeFilter, statusFilter,
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
        status: statusFilter ?? undefined,
        userId,
        includeIndirect,
      }),
    placeholderData: keepPreviousData,
    // A stored pool pick waits for the registry (one fetch, never a stale-filtered first page).
    enabled: storedPoolId == null || poolTypes !== undefined,
  });

  async function runAction(
    id: number,
    run: (id: number) => Promise<void>,
    successKey: ParseKeys,
  ) {
    setActingId(id);
    setActionError(null);
    try {
      await run(id);
      await invalidateDaysOff(queryClient);
      showSuccessToast(t(successKey));
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 409
          ? t("daysOff.error.invalidTransition")
          : saveErrorMessage(err, t, {
              forbidden: "daysOff.error.actionPermission",
              notFound: "daysOff.error.gone",
              failedStatus: "daysOff.error.actionFailedStatus",
              failed: "daysOff.error.actionFailed",
            }),
      );
    } finally {
      setActingId(null);
      setPending(null);
    }
  }

  function rowActions(r: DaysOffListItem) {
    // The server-computed capability flag (v2.31.0 — the team-KPI canManage precedent)
    // replaces the old client-side owner/date inference: the caller owns the row or manages
    // its owner transitively, and it is still REQUESTED/ACCEPTED. Date-independent.
    const cancelButton = r.canCancel ? (
      <Button
        variant="subtle"
        color="red"
        size="xs"
        leftSection={<IconX size={14} />}
        loading={actingId === r.id}
        disabled={actingId != null}
        onClick={() => setPending({ kind: "cancel", id: r.id })}
        aria-label={
          view === "own"
            ? t("daysOff.cancelAria", { date: r.startDate })
            : t("daysOff.cancelForAria", { name: r.userName, date: r.startDate })
        }
      >
        {t("daysOff.action.cancel")}
      </Button>
    ) : null;
    // Accept/reject follow the server's canResolve (v2.32.0; chain-wide since v2.33.0 — a
    // REQUESTED row of anyone in the caller's subtree), exactly matching the server's rights.
    if (r.canResolve) {
      return (
        <Group gap={4} wrap="nowrap">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconCheck size={14} />}
            loading={actingId === r.id}
            disabled={actingId != null}
            onClick={() => void runAction(r.id, acceptDaysOff, "daysOff.toast.accepted")}
            aria-label={t("daysOff.acceptAria", { name: r.userName, date: r.startDate })}
          >
            {t("daysOff.action.accept")}
          </Button>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconX size={14} />}
            disabled={actingId != null}
            onClick={() => setPending({ kind: "reject", id: r.id })}
            aria-label={t("daysOff.rejectAria", { name: r.userName, date: r.startDate })}
          >
            {t("daysOff.action.reject")}
          </Button>
          {cancelButton}
        </Group>
      );
    }
    return cancelButton;
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
        <Select
          label={t("common.field.status")}
          data={[
            { value: "", label: t("common.state.any") },
            ...STATUS_VALUES.map((s) => ({ value: s, label: t(`daysOff.status.${s}`) })),
          ]}
          value={statusFilter ?? ""}
          onChange={(v) => setStatusFilter((v as DaysOffStatus) || null)}
          allowDeselect={false}
          w={170}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("daysOff.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}
      {actionError && (
        <Alert color="red" variant="light">
          {actionError}
        </Alert>
      )}

      <Table>
        <Table.Thead>
          <Table.Tr>
            {personVisible && (
              <Table.Th>
                <SortHeader
                  field="userName"
                  label={t("daysOff.person")}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            )}
            {(["startDate", "endDate", "days", "type", "status", "createdAt"] as const).map((f) => (
              <Table.Th key={f}>
                <SortHeader
                  field={f}
                  label={t(
                    f === "status"
                      ? "common.field.status"
                      : f === "type"
                        ? "daysOff.type.label"
                        : `daysOff.column.${f}`,
                  )}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            ))}
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((r) => (
              <Table.Tr key={r.id}>
                {personVisible && (
                  <Table.Td>
                    <PersonCell
                      userId={r.userId}
                      name={r.userName}
                      deleted={r.userDeleted}
                      currentUserId={currentUserId}
                    />
                  </Table.Td>
                )}
                <Table.Td style={{ whiteSpace: "nowrap" }}>
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
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
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
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {formatDays(r.days, i18n.language)}
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {/* A paid row names its pool (v3.2.0); pre-pool rows and UNPAID keep the type word. */}
                  {r.type === "PAID" ? (r.poolName ?? t("daysOff.type.PAID")) : t("daysOff.type.UNPAID")}
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <Group gap={4} wrap="nowrap">
                    <DaysOffStatusBadge status={r.status} />
                    {r.status === "CANCELLED" && r.cancelReason != null && (
                      // The cancellation record (v2.31.0): who withdrew it and why. Rows
                      // cancelled before the rework carry no reason and get no affordance.
                      <Popover width={320} withArrow shadow="md">
                        <Popover.Target>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            aria-label={t("daysOff.cancelReasonAria")}
                          >
                            <IconInfoCircle size={16} />
                          </ActionIcon>
                        </Popover.Target>
                        <Popover.Dropdown>
                          <Stack gap={4}>
                            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                              {r.cancelReason}
                            </Text>
                            {r.cancelledByName != null && r.cancelledAt != null && (
                              <Text size="xs" c="dimmed">
                                {t("daysOff.cancelledByLine", {
                                  author: r.cancelledByName,
                                  date: formatDate(r.cancelledAt, i18n.language),
                                })}
                              </Text>
                            )}
                          </Stack>
                        </Popover.Dropdown>
                      </Popover>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(r.createdAt)}>
                  {formatDate(r.createdAt, i18n.language)}
                </Table.Td>
                <Table.Td>{rowActions(r)}</Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconBeach size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("daysOff.noRequests")}
                  action={emptyAction}
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
        rowsPerPageLabelKey="daysOff.rowsPerPage"
      />

      <ConfirmActionModal
        opened={pending?.kind === "reject"}
        onClose={() => setPending(null)}
        title={t("daysOff.rejectTitle")}
        message={t("daysOff.rejectMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("daysOff.action.reject")}
        onConfirm={() => {
          if (!pending) return;
          void runAction(pending.id, rejectDaysOff, "daysOff.toast.rejected");
        }}
        loading={actingId != null}
      />

      {/* Cancellation always records a reason (v2.31.0) — the required-textarea modal. */}
      <DaysOffCancelModal
        opened={pending?.kind === "cancel"}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending) return;
          void runAction(pending.id, (id) => cancelDaysOff(id, reason), "daysOff.toast.cancelled");
        }}
        loading={actingId != null}
      />
    </Stack>
  );
}
