import { useState } from "react";
import { Alert, Button, Group, Select, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBeach, IconCheck, IconX } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  acceptDaysOff,
  ApiError,
  cancelDaysOff,
  getUserId,
  listDaysOff,
  rejectDaysOff,
  type DaysOffListItem,
  type DaysOffListView,
  type DaysOffStatus,
  type DaysOffType,
} from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DaysOffStatusBadge from "../components/DaysOffStatusBadge";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { formatDate, formatIsoDate, formatTimestamp, todayIsoDate } from "../utils/datetime";
import { formatDays, isCancellable } from "../utils/daysOffCost";
import { invalidateDaysOff } from "../utils/daysOffQueries";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const BASE_SORT_FIELDS = ["startDate", "endDate", "days", "type", "status", "createdAt"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "userName";

const STATUS_VALUES = ["REQUESTED", "ACCEPTED", "REJECTED", "CANCELLED"] as const;
const TYPE_VALUES = ["PAID", "UNPAID"] as const;

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
}: {
  view: DaysOffListView;
  /** Pin to one user (required with view="user"; the drill-down filter on "managed"). */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
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
  const [typeFilter, setTypeFilter] = useStoredState<DaysOffType | null>(
    `${storeKey}.filter.type`, null, isOneOfOrNull(TYPE_VALUES),
  );
  const [statusFilter, setStatusFilter] = useStoredState<DaysOffStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const activeFilterCount =
    (personVisible && userFilter.trim() ? 1 : 0) + (typeFilter ? 1 : 0) + (statusFilter ? 1 : 0);
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
      "daysOff", view, userId, page, pageSize, sortParam, debouncedUser, typeFilter, statusFilter,
    ],
    queryFn: () =>
      listDaysOff({
        view,
        page,
        pageSize,
        sort: sortParam,
        userName: (personVisible && debouncedUser) || undefined,
        type: typeFilter ?? undefined,
        status: statusFilter ?? undefined,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  async function runAction(
    id: number,
    run: (id: number) => Promise<void>,
    successKey: string,
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
    if (view === "own" && isCancellable(r.status, r.startDate, todayIsoDate())) {
      return (
        <Button
          variant="subtle"
          color="red"
          size="xs"
          leftSection={<IconX size={14} />}
          loading={actingId === r.id}
          disabled={actingId != null}
          onClick={() => setPending({ kind: "cancel", id: r.id })}
          aria-label={t("daysOff.cancelAria", { date: r.startDate })}
        >
          {t("daysOff.action.cancel")}
        </Button>
      );
    }
    if (view === "managed" && r.status === "REQUESTED") {
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
        </Group>
      );
    }
    return null;
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
            ...TYPE_VALUES.map((v) => ({ value: v, label: t(`daysOff.type.${v}`) })),
          ]}
          value={typeFilter ?? ""}
          onChange={(v) => setTypeFilter((v as DaysOffType) || null)}
          allowDeselect={false}
          w={160}
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
          {error instanceof Error ? error.message : t("daysOff.unknownError")}
        </Alert>
      )}
      {actionError && (
        <Alert color="red" variant="light">
          {actionError}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
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
                <Table.Td style={{ whiteSpace: "nowrap" }}>{t(`daysOff.type.${r.type}`)}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <DaysOffStatusBadge status={r.status} />
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
        opened={pending != null}
        onClose={() => setPending(null)}
        title={t(pending?.kind === "reject" ? "daysOff.rejectTitle" : "daysOff.cancelTitle")}
        message={t(pending?.kind === "reject" ? "daysOff.rejectMessage" : "daysOff.cancelMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t(
          pending?.kind === "reject" ? "daysOff.action.reject" : "daysOff.action.cancelConfirm",
        )}
        onConfirm={() => {
          if (!pending) return;
          void runAction(
            pending.id,
            pending.kind === "reject" ? rejectDaysOff : cancelDaysOff,
            pending.kind === "reject" ? "daysOff.toast.rejected" : "daysOff.toast.cancelled",
          );
        }}
        loading={actingId != null}
      />
    </Stack>
  );
}
