import type { ParseKeys } from "i18next";
import { useState } from "react";
import { Alert, Group, Select, Stack, Text } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconArchive,
  IconArrowBackUp,
  IconEye,
  IconPencil,
  IconTargetArrow,
} from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { archiveGoal, deactivateGoal, listGoals, type GoalListItem, type GoalListView, type GoalStatus } from "../api/goals";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import FilterPanel from "../components/FilterPanel";
import GoalCloseModal from "../components/GoalCloseModal";
import GoalStatusBadge from "../components/GoalStatusBadge";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { createdWindowCutoff, createdWindowOptions, formatIsoDate, type CreatedWindow } from "../utils/datetime";
import { goalSaveErrorMessage } from "../utils/goalForm";
import { goalEditLink, goalViewLink } from "../utils/goalLinks";
import { invalidateGoal } from "../utils/goalQueries";
import { formatTargetValue, GoalCurrentValue, isGoalOverdue, OverdueBadge } from "../utils/goalValues";
import { showSuccessToast } from "../utils/toast";
import { loadErrorMessage } from "../utils/saveError";

const BASE_SORT_FIELDS = ["title", "createdAt", "dueDate", "status", "targetValue", "currentValue"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "managerName" | "subordinateName";

const CREATED_WINDOWS = ["all", "month", "sixMonths"] as const;
const STATUS_VALUES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
const REPORTS_SCOPES = ["direct", "all"] as const;

// The one filterable + sortable person column a goals view shows (the OneOnOneTable idiom):
// whose goals these are is pinned by the embedding page, so the *other* party is the column.
type PersonColumn = {
  field: "managerName" | "subordinateName";
  labelKey: ParseKeys;
  clearFilterLabelKey: ParseKeys;
  /** localStorage atom under the view's settings namespace. */
  id: (g: GoalListItem) => number;
  name: (g: GoalListItem) => string;
  deleted: (g: GoalListItem) => boolean;
};

const MANAGER_COLUMN: PersonColumn = {
  field: "managerName",
  labelKey: "goal.manager",
  clearFilterLabelKey: "goal.clearManagerFilter",
  id: (g) => g.managerId,
  name: (g) => g.managerName,
  deleted: (g) => g.managerDeleted,
};

const SUBORDINATE_COLUMN: PersonColumn = {
  field: "subordinateName",
  labelKey: "goal.subordinate",
  clearFilterLabelKey: "goal.clearSubordinateFilter",
  id: (g) => g.subordinateId,
  name: (g) => g.subordinateName,
  deleted: (g) => g.subordinateDeleted,
};

// Per-view differences, declaratively (the OneOnOneTable/FeedbackTable shape): which person
// columns the view shows — own = who set the goal, managed/team = whose goal it is / who set
// it, and the HR auditor view (`user`) shows both parties (the audited person can sit on
// either side). The row actions are NOT per-view but id-derived (the server enforces the same
// rules): the manager edits DRAFT rows and gets the Lifecycle ▾ menu on ACTIVE ones; BOTH
// parties get Update on ACTIVE rows (v2.8.0 — progress is the pair's shared write); everyone
// else views.
const VIEW_CONFIG: Record<GoalListView, { personColumns: PersonColumn[] }> = {
  own: { personColumns: [MANAGER_COLUMN] },
  managed: { personColumns: [SUBORDINATE_COLUMN] },
  team: { personColumns: [MANAGER_COLUMN] },
  user: { personColumns: [MANAGER_COLUMN, SUBORDINATE_COLUMN] },
};

/**
 * The goals list — filters (title substring, person substring, creation window, status),
 * sortable columns, paging. Reusable across the caller-relative views like OneOnOneTable;
 * exercised today by MyGoals (`own`, unpinned) and the /users/:id/goals drill-downs (`own`
 * pinned by managerId, `managed` pinned by subordinateId). The person column hides when its
 * party is pinned — the embedding page already names that person in its title.
 */
export default function GoalTable({
  view,
  managerId,
  subordinateId,
  userId,
  settingsKey,
  backTo,
  withReportsScope,
  emptyAction,
  tourId,
}: {
  view: GoalListView;
  /** Scope to one manager's goals (the per-manager drill-down). */
  managerId?: number;
  /** Scope to one subordinate's goals (the per-subordinate drill-down). */
  subordinateId?: number;
  /** Required with view="user" (the HR auditor view): whose goals to list. */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
  /**
   * Show the "Reports" direct/all filter and derive the includeIndirect API param from it
   * (the TeamMembersTable pattern) — the manager-side "Goals I've set" tab.
   */
  withReportsScope?: boolean;
  /** The hub page's creation link for the empty state (v3.4.0, see EmptyCtaLink). */
  emptyAction?: ReactNode;
  /** Forwarded to the Filters toggle as `data-tour` (a tutorial anchor). */
  tourId?: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const { personColumns } = VIEW_CONFIG[view];
  // A person column hides when a drill-down pins that party — the page names them already.
  const visibleColumns = personColumns.filter(
    (c) =>
      !(c.field === "managerName" && managerId != null) &&
      !(c.field === "subordinateName" && subordinateId != null),
  );
  const sortFields: readonly SortField[] = [
    ...BASE_SORT_FIELDS,
    ...visibleColumns.map((c) => c.field),
  ];
  const columnCount = sortFields.length + 1; // sortable columns + the actions column

  const storeKey = settingsKey ?? `goals.${view}`;
  const [titleFilter, setTitleFilter] = useStoredState(`${storeKey}.filter.title`, "", isString);
  // One atom per party (the OneOnOneTable scheme; single-column views keep their old keys).
  const [managerFilter, setManagerFilter] = useStoredState(
    `${storeKey}.filter.manager`, "", isString,
  );
  const [subordinateFilter, setSubordinateFilter] = useStoredState(
    `${storeKey}.filter.subordinate`, "", isString,
  );
  const personFilters: Record<
    PersonColumn["field"],
    { value: string; set: (v: string) => void }
  > = {
    managerName: { value: managerFilter, set: setManagerFilter },
    subordinateName: { value: subordinateFilter, set: setSubordinateFilter },
  };
  const [createdWindow, setCreatedWindow] = useStoredState<CreatedWindow>(
    `${storeKey}.filter.createdWindow`, "all", isOneOf(CREATED_WINDOWS),
  );
  const [statusFilter, setStatusFilter] = useStoredState<GoalStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const [reportsScope, setReportsScope] = useStoredState<(typeof REPORTS_SCOPES)[number]>(
    `${storeKey}.filter.reportsScope`, "direct", isOneOf(REPORTS_SCOPES),
  );
  const includeIndirect = withReportsScope === true && reportsScope === "all";
  const activeFilterCount =
    (titleFilter.trim() ? 1 : 0) +
    visibleColumns.filter((c) => personFilters[c.field].value.trim()).length +
    (createdWindow !== "all" ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedTitle] = useDebouncedValue(titleFilter, 300);
  const [debouncedManager] = useDebouncedValue(managerFilter, 300);
  const [debouncedSubordinate] = useDebouncedValue(subordinateFilter, 300);
  const managerVisible = visibleColumns.some((c) => c.field === "managerName");
  const subordinateVisible = visibleColumns.some((c) => c.field === "subordinateName");

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "createdAt",
      [debouncedTitle, debouncedManager, debouncedSubordinate, createdWindow, statusFilter, includeIndirect],
      { key: storeKey, sortFields },
      "desc", // newest goals first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "goals",
      view,
      managerId,
      subordinateId,
      userId,
      page,
      pageSize,
      sortParam,
      debouncedTitle,
      debouncedManager,
      debouncedSubordinate,
      createdWindow,
      statusFilter,
      includeIndirect,
    ],
    queryFn: () =>
      listGoals({
        view,
        page,
        pageSize,
        sort: sortParam,
        title: debouncedTitle || undefined,
        managerName: (managerVisible && debouncedManager) || undefined,
        subordinateName: (subordinateVisible && debouncedSubordinate) || undefined,
        status: statusFilter ?? undefined,
        managerId,
        subordinateId,
        createdAtGte: createdWindowCutoff(createdWindow),
        includeIndirect: includeIndirect || undefined,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  const queryClient = useQueryClient();
  // Row-side lifecycle actions (v2.8.0): Return-to-draft behind a ConfirmActionModal, Archive
  // behind the summary modal — one pending target per modal (the DaysOffTable idiom).
  const [pendingDeactivate, setPendingDeactivate] = useState<GoalListItem | null>(null);
  const [pendingArchive, setPendingArchive] = useState<GoalListItem | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runLifecycle(goalId: number, run: () => Promise<void>, successKey: ParseKeys) {
    setActing(true);
    setActionError(null);
    try {
      await run();
      await invalidateGoal(queryClient, goalId);
      showSuccessToast(t(successKey));
    } catch (err) {
      setActionError(goalSaveErrorMessage(err, t));
    } finally {
      setActing(false);
      setPendingDeactivate(null);
      setPendingArchive(null);
    }
  }

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey} tourId={tourId}>
        <ClearableTextInput
          label={t("goal.title")}
          value={titleFilter}
          onChange={setTitleFilter}
          clearLabel={t("goal.clearTitleFilter")}
        />
        {visibleColumns.map((c) => (
          <ClearableTextInput
            key={c.field}
            label={t(c.labelKey)}
            value={personFilters[c.field].value}
            onChange={personFilters[c.field].set}
            clearLabel={t(c.clearFilterLabelKey)}
          />
        ))}
        <Select
          label={t("goal.createdAt")}
          data={createdWindowOptions(t)}
          value={createdWindow}
          onChange={(v) => setCreatedWindow((v as CreatedWindow) ?? "all")}
          allowDeselect={false}
          w={180}
        />
        <Select
          label={t("common.field.status")}
          data={[
            { value: "", label: t("common.state.any") },
            ...STATUS_VALUES.map((s) => ({ value: s, label: t(`goal.status.${s}`) })),
          ]}
          value={statusFilter ?? ""}
          onChange={(v) => setStatusFilter((v as GoalStatus) || null)}
          allowDeselect={false}
          w={160}
        />
        {withReportsScope && <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />}
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("goal.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}
      {actionError && (
        <Alert color="red" variant="light">
          {actionError}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable><SortHeader
                field="title"
                label={t("goal.title")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            {visibleColumns.map((c) => (
              <ResponsiveTable.Th sortable key={c.field}><SortHeader
                  field={c.field}
                  label={t(c.labelKey)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            ))}
            <ResponsiveTable.Th sortable><SortHeader
                field="createdAt"
                label={t("goal.createdAt")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="dueDate"
                label={t("goal.dueDate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="targetValue"
                label={t("goal.target")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="currentValue"
                label={t("goal.current")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((g) => {
              const isRowManager = currentUserId != null && g.managerId === currentUserId;
              const isRowSubordinate = currentUserId != null && g.subordinateId === currentUserId;
              // DRAFT: the manager edits the definition. ACTIVE: BOTH parties update progress
              // (v2.8.0), the manager additionally gets the Lifecycle ▾ menu. Everyone else views.
              const canEditDraft = isRowManager && g.status === "DRAFT";
              const canUpdate = g.status === "ACTIVE" && (isRowManager || isRowSubordinate);
              const backParam = backTo || undefined;
              return (
                <ResponsiveTable.Tr key={g.id}>
                  <ResponsiveTable.Td label={t("goal.title")} primary>
                    <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
                      {g.title}
                    </Text>
                  </ResponsiveTable.Td>
                  {visibleColumns.map((c) => (
                    <ResponsiveTable.Td key={c.field} label={t(c.labelKey)}>
                      <PersonCell
                        userId={c.id(g)}
                        name={c.name(g)}
                        deleted={c.deleted(g)}
                        currentUserId={currentUserId}
                      />
                    </ResponsiveTable.Td>
                  ))}
                  <ResponsiveTable.Td label={t("goal.createdAt")}>
                    <DateCell value={g.createdAt} mode="date" />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("goal.dueDate")}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm">{formatIsoDate(g.dueDate, i18n.language)}</Text>
                      {isGoalOverdue(g.status, g.dueDate) && <OverdueBadge />}
                    </Group>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("common.field.status")}>
                    <GoalStatusBadge status={g.status} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("goal.target")}>
                    {formatTargetValue(g.type, g.targetValue, g.targetDirection, i18n.language)}
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("goal.current")}>
                    <GoalCurrentValue
                      type={g.type}
                      currentValue={g.currentValue}
                      milestonesDone={g.milestonesDone}
                      milestonesTotal={g.milestonesTotal}
                      locale={i18n.language}
                    />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td actions>
                    <RowActions
                      name={g.title}
                      primary={
                        canEditDraft
                          ? {
                              icon: <IconPencil size={16} />,
                              label: t("common.action.edit"),
                              ariaLabel: t("goal.editAria", { title: g.title }),
                              to: goalEditLink(g.id, view, backParam),
                            }
                          : canUpdate
                            ? {
                                icon: <IconPencil size={16} />,
                                label: t("goal.action.update"),
                                ariaLabel: t("goal.updateAria", { title: g.title }),
                                to: goalEditLink(g.id, view, backParam),
                              }
                            : {
                                icon: <IconEye size={16} />,
                                label: t("common.action.view"),
                                ariaLabel: t("goal.viewAria", { title: g.title }),
                                to: goalViewLink(g.id, view, backParam),
                              }
                      }
                      // The ACTIVE goal's lifecycle menu keeps its asserted trigger name.
                      menuLabel={t("goal.lifecycleFor", { title: g.title })}
                      items={
                        isRowManager && g.status === "ACTIVE"
                          ? [
                              {
                                icon: <IconArrowBackUp size={14} />,
                                label: t("goal.action.deactivate"),
                                onClick: () => setPendingDeactivate(g),
                                disabled: acting,
                              },
                              {
                                icon: <IconArchive size={14} />,
                                label: t("goal.action.close"),
                                onClick: () => setPendingArchive(g),
                                disabled: acting,
                              },
                            ]
                          : []
                      }
                    />
                  </ResponsiveTable.Td>
                </ResponsiveTable.Tr>
              );
            })
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconTargetArrow size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("goal.noGoals")}
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
        rowsPerPageLabelKey="goal.rowsPerPage"
      />

      <ConfirmActionModal
        opened={pendingDeactivate != null}
        onClose={() => !acting && setPendingDeactivate(null)}
        title={t("goal.deactivateConfirmTitle")}
        message={t("goal.deactivateConfirmMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("goal.action.deactivate")}
        confirmColor="lettuce"
        loading={acting}
        onConfirm={() => {
          if (!pendingDeactivate) return;
          void runLifecycle(
            pendingDeactivate.id,
            () => deactivateGoal(pendingDeactivate.id),
            "goal.toast.deactivated",
          );
        }}
      />
      <GoalCloseModal
        opened={pendingArchive != null}
        onClose={() => setPendingArchive(null)}
        loading={acting}
        onConfirm={(summary) => {
          if (!pendingArchive) return;
          void runLifecycle(
            pendingArchive.id,
            () => archiveGoal(pendingArchive.id, { summary }),
            "goal.toast.archived",
          );
        }}
      />
    </Stack>
  );
}
