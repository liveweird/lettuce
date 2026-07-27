import { Link as RouterLink } from "react-router-dom";
import { Alert, Button, Group, Select, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconEye, IconPencil, IconTargetArrow } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getUserId,
  listGoals,
  type GoalListItem,
  type GoalListView,
  type GoalStatus,
} from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import GoalStatusBadge from "../components/GoalStatusBadge";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import {
  createdWindowCutoff,
  createdWindowOptions,
  formatDate,
  formatIsoDate,
  formatTimestamp,
  type CreatedWindow,
} from "../utils/datetime";
import { goalEditLink, goalViewLink } from "../utils/goalLinks";
import { formatGoalValue, GoalCurrentValue, isGoalOverdue, OverdueBadge } from "../utils/goalValues";

const BASE_SORT_FIELDS = ["title", "createdAt", "dueDate", "status", "targetValue", "currentValue"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "managerName" | "subordinateName";

const CREATED_WINDOWS = ["all", "month", "sixMonths"] as const;
const STATUS_VALUES = ["DRAFT", "ACTIVE", "CLOSED"] as const;

// The one filterable + sortable person column a goals view shows (the OneOnOneTable idiom):
// whose goals these are is pinned by the embedding page, so the *other* party is the column.
type PersonColumn = {
  field: "managerName" | "subordinateName";
  labelKey: string;
  clearFilterLabelKey: string;
  /** localStorage atom under the view's settings namespace. */
  storageAtom: string;
  id: (g: GoalListItem) => number;
  name: (g: GoalListItem) => string;
  deleted: (g: GoalListItem) => boolean;
};

const MANAGER_COLUMN: PersonColumn = {
  field: "managerName",
  labelKey: "goal.manager",
  clearFilterLabelKey: "goal.clearManagerFilter",
  storageAtom: "filter.manager",
  id: (g) => g.managerId,
  name: (g) => g.managerName,
  deleted: (g) => g.managerDeleted,
};

const SUBORDINATE_COLUMN: PersonColumn = {
  field: "subordinateName",
  labelKey: "goal.subordinate",
  clearFilterLabelKey: "goal.clearSubordinateFilter",
  storageAtom: "filter.subordinate",
  id: (g) => g.subordinateId,
  name: (g) => g.subordinateName,
  deleted: (g) => g.subordinateDeleted,
};

// Per-view differences, declaratively (the OneOnOneTable/FeedbackTable shape): which person
// column the view shows — own = who set the goal, managed/team = whose goal it is / who set it.
// The row action is NOT per-view: at any view the goal's manager edits DRAFT/ACTIVE rows and
// everyone else views (the server enforces the same rule).
const VIEW_CONFIG: Record<GoalListView, { personColumn: PersonColumn }> = {
  own: { personColumn: MANAGER_COLUMN },
  managed: { personColumn: SUBORDINATE_COLUMN },
  team: { personColumn: MANAGER_COLUMN },
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
  settingsKey,
  backTo,
}: {
  view: GoalListView;
  /** Scope to one manager's goals (the per-manager drill-down). */
  managerId?: number;
  /** Scope to one subordinate's goals (the per-subordinate drill-down). */
  subordinateId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const { personColumn } = VIEW_CONFIG[view];
  const personPinned =
    (personColumn.field === "managerName" && managerId != null) ||
    (personColumn.field === "subordinateName" && subordinateId != null);
  const showPerson = !personPinned;
  const sortFields: readonly SortField[] = showPerson
    ? [...BASE_SORT_FIELDS, personColumn.field]
    : BASE_SORT_FIELDS;
  const columnCount = sortFields.length + 1; // sortable columns + the actions column

  const storeKey = settingsKey ?? `goals.${view}`;
  const [titleFilter, setTitleFilter] = useStoredState(`${storeKey}.filter.title`, "", isString);
  const [personFilter, setPersonFilter] = useStoredState(
    `${storeKey}.${personColumn.storageAtom}`, "", isString,
  );
  const [createdWindow, setCreatedWindow] = useStoredState<CreatedWindow>(
    `${storeKey}.filter.createdWindow`, "all", isOneOf(CREATED_WINDOWS),
  );
  const [statusFilter, setStatusFilter] = useStoredState<GoalStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const activeFilterCount =
    (titleFilter.trim() ? 1 : 0) +
    (showPerson && personFilter.trim() ? 1 : 0) +
    (createdWindow !== "all" ? 1 : 0) +
    (statusFilter ? 1 : 0);

  const [debouncedTitle] = useDebouncedValue(titleFilter, 300);
  const [debouncedPerson] = useDebouncedValue(personFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "createdAt",
      [debouncedTitle, debouncedPerson, createdWindow, statusFilter],
      { key: storeKey, sortFields },
      "desc", // newest goals first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "goals",
      view,
      managerId,
      subordinateId,
      page,
      pageSize,
      sortParam,
      debouncedTitle,
      debouncedPerson,
      createdWindow,
      statusFilter,
    ],
    queryFn: () =>
      listGoals({
        view,
        page,
        pageSize,
        sort: sortParam,
        title: debouncedTitle || undefined,
        managerName:
          (showPerson && personColumn.field === "managerName" && debouncedPerson) || undefined,
        subordinateName:
          (showPerson && personColumn.field === "subordinateName" && debouncedPerson) || undefined,
        status: statusFilter ?? undefined,
        managerId,
        subordinateId,
        createdAtGte: createdWindowCutoff(createdWindow),
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <ClearableTextInput
          label={t("goal.title")}
          value={titleFilter}
          onChange={setTitleFilter}
          clearLabel={t("goal.clearTitleFilter")}
        />
        {showPerson && (
          <ClearableTextInput
            label={t(personColumn.labelKey)}
            value={personFilter}
            onChange={setPersonFilter}
            clearLabel={t(personColumn.clearFilterLabelKey)}
          />
        )}
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
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("goal.loadListError")}>
          {error instanceof Error ? error.message : t("goal.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="title"
                label={t("goal.title")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            {showPerson && (
              <Table.Th>
                <SortHeader
                  field={personColumn.field}
                  label={t(personColumn.labelKey)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            )}
            <Table.Th>
              <SortHeader
                field="createdAt"
                label={t("goal.createdAt")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="dueDate"
                label={t("goal.dueDate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="targetValue"
                label={t("goal.target")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="currentValue"
                label={t("goal.current")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((g) => {
              const canEdit =
                currentUserId != null &&
                g.managerId === currentUserId &&
                (g.status === "DRAFT" || g.status === "ACTIVE");
              const backParam = backTo || undefined;
              return (
                <Table.Tr key={g.id}>
                  <Table.Td>
                    <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
                      {g.title}
                    </Text>
                  </Table.Td>
                  {showPerson && (
                    <Table.Td>
                      <PersonCell
                        userId={personColumn.id(g)}
                        name={personColumn.name(g)}
                        deleted={personColumn.deleted(g)}
                        currentUserId={currentUserId}
                      />
                    </Table.Td>
                  )}
                  <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(g.createdAt)}>
                    {formatDate(g.createdAt, i18n.language)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm">{formatIsoDate(g.dueDate, i18n.language)}</Text>
                      {isGoalOverdue(g.status, g.dueDate) && <OverdueBadge />}
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <GoalStatusBadge status={g.status} />
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatGoalValue(g.type, g.targetValue, i18n.language)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <GoalCurrentValue
                      type={g.type}
                      currentValue={g.currentValue}
                      achieved={g.achieved}
                      locale={i18n.language}
                    />
                  </Table.Td>
                  <Table.Td>
                    {canEdit ? (
                      <Button
                        component={RouterLink}
                        to={goalEditLink(g.id, view, backParam)}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconPencil size={14} />}
                        aria-label={t("goal.editAria", { title: g.title })}
                      >
                        {t("common.action.edit")}
                      </Button>
                    ) : (
                      <Button
                        component={RouterLink}
                        to={goalViewLink(g.id, view, backParam)}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconEye size={14} />}
                        aria-label={t("goal.viewAria", { title: g.title })}
                      >
                        {t("common.action.view")}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconTargetArrow size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("goal.noGoals")}
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
        rowsPerPageLabelKey="goal.rowsPerPage"
      />
    </Stack>
  );
}
