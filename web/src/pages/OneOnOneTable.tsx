import { type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Badge, Button, Center, Loader, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCalendarEvent, IconEye, IconPencil } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getUserId,
  listOneOnOnes,
  type OneOnOneListView,
  type OneOnOnePage,
} from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonaChip from "../components/PersonaChip";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isString, useStoredState } from "../hooks/useStoredState";
import { formatIsoDate, formatRelativeTime, formatTimestamp } from "../utils/datetime";

const SORT_FIELDS = ["meetingDate", "managerName", "subordinateName", "lastModified"] as const;
type SortField = (typeof SORT_FIELDS)[number];

type OneOnOneRow = OneOnOnePage["items"][number];

// A person cell: "You" and deleted users render as plain text (the FeedbackTable language).
function PersonCell({
  userId,
  name,
  deleted,
  currentUserId,
  youLabel,
}: {
  userId: number;
  name: string;
  deleted: boolean;
  currentUserId: number | null;
  youLabel: string;
}) {
  if (currentUserId != null && userId === currentUserId) {
    return <Text size="sm">{youLabel}</Text>;
  }
  if (deleted) {
    return <Text size="sm">{name}</Text>;
  }
  return <PersonaChip name={name} />;
}

// A filterable + sortable person column.
type PersonColumn = {
  field: "managerName" | "subordinateName";
  labelKey: string;
  clearFilterLabelKey: string;
  id: (m: OneOnOneRow) => number;
  name: (m: OneOnOneRow) => string;
  deleted: (m: OneOnOneRow) => boolean;
};

const MANAGER_COLUMN: PersonColumn = {
  field: "managerName",
  labelKey: "oneOnOne.manager",
  clearFilterLabelKey: "oneOnOne.clearManagerFilter",
  id: (m) => m.managerId,
  name: (m) => m.managerName,
  deleted: (m) => m.managerDeleted,
};

const SUBORDINATE_COLUMN: PersonColumn = {
  field: "subordinateName",
  labelKey: "oneOnOne.subordinate",
  clearFilterLabelKey: "oneOnOne.clearSubordinateFilter",
  id: (m) => m.subordinateId,
  name: (m) => m.subordinateName,
  deleted: (m) => m.subordinateDeleted,
};

type ActionContext = {
  backParam: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

// Per-view differences: which person columns appear and how the row action is rendered —
// the manager edits their meetings, everyone else views.
const VIEW_CONFIG: Record<
  OneOnOneListView,
  {
    personColumns: PersonColumn[];
    renderAction: (m: OneOnOneRow, ctx: ActionContext) => ReactNode;
  }
> = {
  own: {
    personColumns: [MANAGER_COLUMN],
    renderAction: (m, { t, backParam }) => (
      <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.managerName })} backParam={backParam} />
    ),
  },
  managed: {
    personColumns: [SUBORDINATE_COLUMN],
    renderAction: (m, { t, backParam }) => (
      <Button
        component={RouterLink}
        to={`/one-on-ones/${m.id}/edit?from=managed${backParam}`}
        color="blue"
        variant="subtle"
        size="xs"
        leftSection={<IconPencil size={14} />}
        aria-label={t("oneOnOne.editWith", { name: m.subordinateName })}
      >
        {t("common.action.edit")}
      </Button>
    ),
  },
  team: {
    personColumns: [MANAGER_COLUMN, SUBORDINATE_COLUMN],
    renderAction: (m, { t, backParam }) => (
      <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.subordinateName })} backParam={backParam} from="team" />
    ),
  },
};

function ViewButton({
  m,
  label,
  aria,
  backParam,
  from,
}: {
  m: OneOnOneRow;
  label: string;
  aria: string;
  backParam: string;
  from?: string;
}) {
  return (
    <Button
      component={RouterLink}
      to={`/one-on-ones/${m.id}/view?${from ? `from=${from}` : "from=own"}${backParam}`}
      color="blue"
      variant="subtle"
      size="xs"
      leftSection={<IconEye size={14} />}
      aria-label={aria}
    >
      {label}
    </Button>
  );
}

export default function OneOnOneTable({ view }: { view: OneOnOneListView }) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const config = VIEW_CONFIG[view];
  const backParam = "";
  const columnCount = config.personColumns.length + 6; // date + 3 counts + modified + actions

  const storeKey = `oneOnOnes.${view}`;
  const [managerFilter, setManagerFilter] = useStoredState(
    `${storeKey}.filter.manager`, "", isString,
  );
  const [subordinateFilter, setSubordinateFilter] = useStoredState(
    `${storeKey}.filter.subordinate`, "", isString,
  );
  // Team view only: subordinates limited to direct reports (default) or the whole chain.
  const [reportsScope, setReportsScope] = useStoredState<"direct" | "all">(
    `${storeKey}.filter.reportsScope`, "direct", isOneOf(["direct", "all"]),
  );
  const includeIndirect = view === "team" && reportsScope === "all";
  const activeFilterCount =
    (managerFilter.trim() ? 1 : 0) +
    (subordinateFilter.trim() ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedManager] = useDebouncedValue(managerFilter, 300);
  const [debouncedSubordinate] = useDebouncedValue(subordinateFilter, 300);

  const personFilters: Record<
    PersonColumn["field"],
    { value: string; set: (v: string) => void }
  > = {
    managerName: { value: managerFilter, set: setManagerFilter },
    subordinateName: { value: subordinateFilter, set: setSubordinateFilter },
  };

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "meetingDate",
      [debouncedManager, debouncedSubordinate, includeIndirect],
      { key: storeKey, sortFields: SORT_FIELDS },
      "desc", // newest meetings first
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "oneOnOnes",
      view,
      page,
      pageSize,
      sortParam,
      debouncedManager,
      debouncedSubordinate,
      includeIndirect,
    ],
    queryFn: () =>
      listOneOnOnes({
        view,
        page,
        pageSize,
        sort: sortParam,
        managerName: debouncedManager || undefined,
        subordinateName: debouncedSubordinate || undefined,
        includeIndirect: includeIndirect || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        {config.personColumns.map((col) => {
          const filter = personFilters[col.field];
          return (
            <ClearableTextInput
              key={col.field}
              label={t(col.labelKey)}
              value={filter.value}
              onChange={filter.set}
              clearLabel={t(col.clearFilterLabelKey)}
            />
          );
        })}
        {view === "team" && (
          <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
        )}
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("oneOnOne.loadListError")}>
          {error instanceof Error ? error.message : t("oneOnOne.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="meetingDate"
                label={t("oneOnOne.meetingDate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            {config.personColumns.map((col) => (
              <Table.Th key={col.field}>
                <SortHeader
                  field={col.field}
                  label={t(col.labelKey)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            ))}
            <Table.Th>{t("oneOnOne.points")}</Table.Th>
            <Table.Th>{t("oneOnOne.decisions")}</Table.Th>
            <Table.Th>{t("oneOnOne.actionItems")}</Table.Th>
            <Table.Th>
              <SortHeader
                field="lastModified"
                label={t("common.field.lastModified")}
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
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {formatIsoDate(m.meetingDate, i18n.language)}
                </Table.Td>
                {config.personColumns.map((col) => (
                  <Table.Td key={col.field}>
                    <PersonCell
                      userId={col.id(m)}
                      name={col.name(m)}
                      deleted={col.deleted(m)}
                      currentUserId={currentUserId}
                      youLabel={t("common.state.you")}
                    />
                  </Table.Td>
                ))}
                <Table.Td>{m.pointCount}</Table.Td>
                <Table.Td>{m.decisionCount}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {m.actionItemCount === 0 ? (
                    <Text size="sm" c="dimmed">
                      0
                    </Text>
                  ) : (
                    <Badge
                      variant="light"
                      color={m.openActionItemCount > 0 ? "yellow" : "green"}
                      style={{ minWidth: "max-content" }}
                    >
                      {t("oneOnOne.openOfTotal", {
                        open: m.openActionItemCount,
                        total: m.actionItemCount,
                      })}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(m.lastModified)}>
                  {formatRelativeTime(m.lastModified, i18n.language)}
                </Table.Td>
                <Table.Td>{config.renderAction(m, { backParam, t })}</Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconCalendarEvent size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("oneOnOne.noMeetings")}
                />
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="oneOnOne.rowsPerPage"
      />
    </Stack>
  );
}
